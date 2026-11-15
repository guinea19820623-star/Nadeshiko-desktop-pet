# 下雨：記得帶傘49 第 37–40 格（祐 2026-11-15）：收起來的傘擋在臉前面，去背時把傘中間（她的臉那塊）摳成半透明，
# 桌面透過來就像傘身瞬間發黑。做法：人物外框裡面、不在邊緣的半透明像素補成不透明，顏色用周圍不透明傘面的顏色混進去。
# build_clips 的 preprocess 會呼叫 fix(frames)（frames[0] 是第 1 格，原圖 768×768）
import numpy as np
from PIL import Image
from scipy import ndimage

FRAMES = (37, 38, 39, 40)


def heal(im):
    f = np.asarray(im).astype(np.float32)
    a = f[..., 3] / 255.0
    solid = a > 0.5
    inside = ndimage.binary_fill_holes(solid)
    inside = ndimage.binary_erosion(inside, iterations=6)          # 外框邊緣的柔邊不動
    hole = inside & (a < 0.97)
    w = (a > 0.85).astype(np.float32)   # 傘面本來就只有八、九成不透明，門檻太高會找不到參考顏色
    rgb = f[..., :3]
    fill = np.zeros_like(rgb); got = np.zeros(a.shape, bool)
    for sg in (8, 16, 32):               # 由近到遠找周圍傘面的顏色，近的找不到才放大範圍
        num = np.stack([ndimage.gaussian_filter(rgb[..., k] * w, sg) for k in range(3)], -1)
        den = ndimage.gaussian_filter(w, sg)
        ok = (den > 0.05) & ~got
        fill[ok] = num[ok] / den[ok][:, None]
        got |= ok
    out = f.copy()
    aa = a[..., None]
    mix = rgb * aa + fill * (1 - aa)
    out[..., :3] = np.where(hole[..., None], mix, rgb)
    out[..., 3] = np.where(hole, 255, f[..., 3])
    return Image.fromarray(out.clip(0, 255).astype(np.uint8), 'RGBA')


def fix(frames):
    for n in FRAMES:
        frames[n - 1] = heal(frames[n - 1])
    return frames

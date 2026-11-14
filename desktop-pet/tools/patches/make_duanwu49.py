# 端午節49（祐 2026-11-15）：香包是被甩上去、從頭頂外繞一圈下來的，第 3、4 格香包在原圖畫面外（上半截被切掉），
# 而桌寵畫布又會再切掉原圖最上面約 33px（track ×1.1196、地面 694），第 5 格香包頂端也會被切到。
# 做法：第 3、4 格把香包和繩子擦掉（擦掉的地方用第 2 格補，頭幾乎沒動），在第 5 格香包要出現的位置聚金光；
#       第 5 格把香包（含繩子上段）整塊往下挪 SHIFT px，讓它整個在畫面內，並留一點金光，像從光裡出現。
# 用法：python tools/patches/make_duanwu49.py [素材資料夾]
import os, sys, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
src = sys.argv[1] if len(sys.argv) > 1 else r'C:/Users/guine/OneDrive/Desktop/claude-workspaces/端午節49'
sheet = Image.open(os.path.join(src, '22_站著發呆_01.png')).convert('RGBA')
W = 768
def frame(n):
    i = n - 1
    return sheet.crop(((i % 7) * W, (i // 7) * W, (i % 7 + 1) * W, (i // 7 + 1) * W))

TOP = 40                        # 畫布看得到的最上緣（原圖座標，留一點邊）
SHIFT = 30                      # 第 5 格香包往下挪多少（原圖 px）；頂端 12 → 42，畫布上就不會被切
SX0, SX1, SY1 = 165, 292, 112   # 第 5 格要往下挪的香包範圍（頭的左上方，背景透明）
f2 = np.asarray(frame(2)).copy()

def remove_sachet(n):
    """把第 n 格（3、4）的香包與繩子擦掉，用第 2 格的像素補回去"""
    f = np.asarray(frame(n)).copy()
    r, g, b, a = [f[..., k].astype(int) for k in range(4)]
    red = (r > 120) & (g < 80) & (b < 80) & (a > 60)
    r2, g2, b2 = [f2[..., k].astype(int) for k in range(3)]
    red2 = (r2 > 120) & (g2 < 80) & (b2 < 80)
    yy, xx = np.mgrid[0:W, 0:W]
    string = red & ~red2 & (xx < 335) & (yy < 270)          # 繩子（髮飾本來就有的紅珠子不算）
    above = (yy < 72) & (a > 0)                             # 頭頂以上：只有香包
    mask = ndimage.binary_dilation(string, iterations=2) | above
    f[mask] = f2[mask]
    return Image.fromarray(f, 'RGBA')

def glow(cx, cy, a, r):
    g = Image.new('RGBA', (W, W), (0, 0, 0, 0)); d = ImageDraw.Draw(g)
    for k in range(24, 0, -1):
        rr = r * k / 24; al = int(255 * a * (1 - k / 24) ** 2.2)
        d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=(255, 226, 150, al))
    return g.filter(ImageFilter.GaussianBlur(5))

def sparkles(cx, cy, n, rad, seed, size):
    rnd = random.Random(seed); g = Image.new('RGBA', (W, W), (0, 0, 0, 0)); d = ImageDraw.Draw(g)
    for _ in range(n):
        ang = rnd.uniform(0, 2 * math.pi); rr = rad * rnd.uniform(0.4, 1.0)
        x, y = cx + math.cos(ang) * rr, cy + math.sin(ang) * rr
        if y < TOP + 6: y = TOP + 6 + (TOP + 6 - y) * 0.5   # 畫布頂端（原圖 y≈33）以上看不到，往下收
        s = size * rnd.uniform(0.6, 1.2)
        d.ellipse((x - s * 2.2, y - s * 2.2, x + s * 2.2, y + s * 2.2), fill=(255, 215, 120, 70))
        d.ellipse((x - s, y - s, x + s, y + s), fill=(255, 250, 225, 235))
        if rnd.random() < 0.45:
            d.line((x - s * 4, y, x + s * 4, y), fill=(255, 245, 210, 160), width=1)
            d.line((x, y - s * 4, x, y + s * 4), fill=(255, 245, 210, 160), width=1)
    return g.filter(ImageFilter.GaussianBlur(0.6))

# 第 5 格：香包整塊往下挪
f5 = np.asarray(frame(5)).copy()
block = f5[0:SY1, SX0:SX1].copy()
f5[0:SY1, SX0:SX1] = 0
out5 = Image.fromarray(f5, 'RGBA')
blk = Image.fromarray(block, 'RGBA')
ys, xs = np.nonzero(block[..., 3] > 40)
CX, CY = SX0 + (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2 + SHIFT   # 挪下來之後香包的中心
layer = Image.new('RGBA', (W, W), (0, 0, 0, 0)); layer.alpha_composite(blk, (SX0, SHIFT))
out5.alpha_composite(layer)
g5 = glow(CX, CY, 0.3, CY - TOP); g5.alpha_composite(sparkles(CX, CY, 10, 55, 5, 2.2))
base5 = Image.new('RGBA', (W, W), (0, 0, 0, 0)); base5.alpha_composite(g5); base5.alpha_composite(out5)
base5.alpha_composite(sparkles(CX, CY, 8, 60, 55, 2.0))
base5.save(os.path.join(HERE, 'duanwu49_f05.png'))

#      柔光  半徑  光點數  範圍  大小
for n, (ga, gr, sn, srad, ss) in {3: (0.35, CY - TOP, 30, 95, 2.8), 4: (0.5, CY - TOP, 22, 65, 2.6)}.items():
    body = remove_sachet(n)
    out = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    out.alpha_composite(glow(CX, CY, ga, gr))
    out.alpha_composite(body)
    out.alpha_composite(sparkles(CX, CY, sn, srad, n, ss))
    out.save(os.path.join(HERE, f'duanwu49_f{n:02d}.png'))
print('ok center', round(CX), round(CY))

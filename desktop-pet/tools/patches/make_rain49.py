# 下雨：記得帶傘49（祐 2026-11-15）：白色蘿莉塔蕾絲傘舉高時，傘面超出影片上緣（第 2、8、9、10、28、29、30 格被切掉）。
# 做法：從同一段影片裡傘面完整的格借傘面（9、10 借 11；28、29 借 27；8、30 借 31 那個正面的圓傘面），
#       先自動找出旋轉、縮放、位移，讓借來的傘面跟被切的那格看得到的部分疊合，再只補「影片上緣以外」那塊，接縫處淡入。
#       補好的格往上多留 PAD px（輸出 768×(768+PAD)），build_clips 會照這個留白擺回去；畫面放不下的部分交給 track 縮小。
#       第 2 格原片是一閃而過的撐開傘（下一格又變成收著），改成第 1、3 格疊在一起、金光聚起來，像傘從光裡出現。
# 用法：python tools/patches/make_rain49.py [素材資料夾]
import os, sys, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage, optimize

HERE = os.path.dirname(os.path.abspath(__file__))
src = sys.argv[1] if len(sys.argv) > 1 else r'C:/Users/guine/OneDrive/Desktop/claude-workspaces/下雨：記得帶傘49'
sheet = Image.open(os.path.join(src, '22_站著發呆_01.png')).convert('RGBA')
W, PAD, SEAM = 768, 140, 16


def frame(n):
    i = n - 1
    return sheet.crop(((i % 7) * W, (i // 7) * W, (i % 7 + 1) * W, (i // 7 + 1) * W))


def umbrella_mask(im, ymax):
    """傘：不透明、偏白偏灰（頭髮、皮膚都偏橘）；只看握把以上"""
    f = np.asarray(im).astype(np.float32)
    r, g, b, a = f[..., 0], f[..., 1], f[..., 2], f[..., 3]
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    sat = (mx - mn) / np.maximum(mx, 1)
    m = (a > 100) & (sat < 0.16) & (mx > 120)
    m[ymax:] = False
    m = ndimage.binary_opening(m, iterations=1)
    lab, k = ndimage.label(m)
    if k:
        big = np.argmax(ndimage.sum(m, lab, range(1, k + 1))) + 1
        m = lab == big
    return ndimage.binary_closing(m, iterations=3)


def pad_top(im):
    out = Image.new('RGBA', (W, W + PAD), (0, 0, 0, 0)); out.alpha_composite(im, (0, PAD)); return out


C = np.array([384.0, 300.0 + PAD])


def warp(img, p, size):
    """p = (θ 度, sx, sy, tx, ty)：來源（已補 PAD）→ 目標（已補 PAD）"""
    th, sx, sy, tx, ty = p
    c, s = math.cos(math.radians(th)), math.sin(math.radians(th))
    # 逆映射：src = D⁻¹ R(-θ) (tgt - C - t) + C
    a, b = c / sx, s / sx
    d, e = -s / sy, c / sy
    ox, oy = C[0] + tx, C[1] + ty
    coeffs = (a, b, C[0] - a * ox - b * oy, d, e, C[1] - d * ox - e * oy)
    return img.transform(size, Image.AFFINE, coeffs, Image.BICUBIC)


def align(sp, tgtim, band, p0, src_ymax, tgt_ymax):
    """sp：來源（已補 PAD）"""
    smp = Image.fromarray((umbrella_mask(sp, src_ymax + PAD) * 255).astype(np.uint8))
    tm = umbrella_mask(tgtim, tgt_ymax)
    q = 4
    tsmall = np.asarray(Image.fromarray((np.vstack([np.zeros((PAD, W), bool), tm]) * 255).astype(np.uint8)).resize((W // q, (W + PAD) // q), Image.BILINEAR)) / 255.0
    rows = slice((PAD) // q, (PAD + band) // q)

    def loss(p):
        wm = warp(smp, p, (W, W + PAD)).resize((W // q, (W + PAD) // q), Image.BILINEAR)
        w = np.asarray(wm)[rows] / 255.0; t = tsmall[rows]
        inter = (w * t).sum(); uni = (w + t - w * t).sum() + 1e-6
        th, sx, sy = p[0], p[1], p[2]
        pen = max(0, abs(th) - 25) / 10 + max(0, abs(math.log(max(sx, 1e-3))) - 0.25) * 4 + max(0, abs(math.log(max(sx, 1e-3) / max(sy, 1e-3))) - 0.2) * 4
        return 1 - inter / uni + pen   # 不准轉太多、拉太長（傘不會變形）

    best = None
    for dth in (-12, -6, 0, 6, 12):
        for dty in (-40, 0, 40):
            x0 = np.array(p0, float) + [dth, 0, 0, 0, dty]
            r = optimize.minimize(loss, x0, method='Nelder-Mead',
                                  options=dict(xatol=0.2, fatol=1e-4, maxiter=400, initial_simplex=None))
            if best is None or r.fun < best.fun:
                best = r
    return best.x, best.fun, smp


def transplant(tn, sn, p0, band=170, src_ymax=330, tgt_ymax=330):
    """sn：整數＝原片第幾格；字串＝已補好的檔（例如第 9 格借補好的第 10 格）"""
    tgt = frame(tn)
    sp = Image.open(os.path.join(HERE, sn)).convert('RGBA') if isinstance(sn, str) else pad_top(frame(sn))
    if len(p0) == 6:   # 第 6 個值 True：直接用給的參數，不自動找（第 30 格自動找的傘頂太高，放不進畫面）
        p, err = np.array(p0[:5], float), float('nan')
    else:
        p, err, _ = align(sp, tgt, band, p0, src_ymax, tgt_ymax)
    keep = ndimage.binary_dilation(umbrella_mask(sp, src_ymax + PAD), iterations=2)
    sarr = np.asarray(sp).copy(); sarr[..., 3] = np.where(keep, sarr[..., 3], 0)
    fill = warp(Image.fromarray(sarr, 'RGBA'), p, (W, W + PAD))
    # 只補影片上緣以外，接縫往下淡入 SEAM px
    fa = np.asarray(fill).astype(np.float32)
    yy = np.arange(W + PAD)[:, None]
    wgt = np.clip((PAD + SEAM - yy) / SEAM, 0, 1)
    raw_a = fa[..., 3].copy()
    fa[..., 3] *= wgt
    out = pad_top(tgt)
    base = np.asarray(out).astype(np.float32)
    # 接縫那一段，原圖傘面伸出借來的傘面外的部分跟著淡出，切口才不會留下直角的小階梯
    outside = ndimage.gaussian_filter((raw_a < 60).astype(np.float32), 2)
    base[..., 3] *= 1 - outside * wgt
    # 接縫：借來的傘面疊在原圖上面（上緣外整塊、往下漸淡）
    a1 = fa[..., 3:4] / 255.0; a0 = base[..., 3:4] / 255.0
    ao = a1 + a0 * (1 - a1)
    rgb = (fa[..., :3] * a1 + base[..., :3] * a0 * (1 - a1)) / np.maximum(ao, 1e-6)
    res = np.concatenate([rgb, ao * 255], axis=2).clip(0, 255).astype(np.uint8)
    im = Image.fromarray(res, 'RGBA')
    a = np.asarray(im)[..., 3]; ys = np.nonzero(a.max(axis=1) > 40)[0]
    print(f'{tn:02d} ← {sn}  err={err:.3f}  p=' + ','.join(f'{v:.2f}' for v in p) + f'  top={ys.min() - PAD}')
    im.save(os.path.join(HERE, f'rain49_f{tn:02d}.png'))
    return im


def glow(cx, cy, a, r, size):
    g = Image.new('RGBA', size, (0, 0, 0, 0)); d = ImageDraw.Draw(g)
    for k in range(24, 0, -1):
        rr = r * k / 24; al = int(255 * a * (1 - k / 24) ** 2.2)
        d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=(255, 226, 150, al))
    return g.filter(ImageFilter.GaussianBlur(5))


def sparkles(cx, cy, n, rad, seed, sz, size):
    rnd = random.Random(seed); g = Image.new('RGBA', size, (0, 0, 0, 0)); d = ImageDraw.Draw(g)
    for _ in range(n):
        ang = rnd.uniform(0, 2 * math.pi); rr = rad * rnd.uniform(0.3, 1.0)
        x, y = cx + math.cos(ang) * rr, cy + math.sin(ang) * rr
        s = sz * rnd.uniform(0.6, 1.2)
        d.ellipse((x - s * 2.2, y - s * 2.2, x + s * 2.2, y + s * 2.2), fill=(255, 215, 120, 70))
        d.ellipse((x - s, y - s, x + s, y + s), fill=(255, 250, 225, 235))
        if rnd.random() < 0.45:
            d.line((x - s * 4, y, x + s * 4, y), fill=(255, 245, 210, 160), width=1)
            d.line((x, y - s * 4, x, y + s * 4), fill=(255, 245, 210, 160), width=1)
    return g.filter(ImageFilter.GaussianBlur(0.6))


def premul_blend(a, b, u):
    A = np.asarray(a).astype(np.float32); B = np.asarray(b).astype(np.float32)
    pa = A[..., :3] * A[..., 3:4] / 255; pb = B[..., :3] * B[..., 3:4] / 255
    al = A[..., 3:4] * (1 - u) + B[..., 3:4] * u
    pc = pa * (1 - u) + pb * u
    rgb = pc * 255 / np.maximum(al, 1e-6)
    return Image.fromarray(np.concatenate([rgb, al], 2).clip(0, 255).astype(np.uint8), 'RGBA')


if __name__ == '__main__':
    # 第 2 格：1、3 疊在一起，金光在第 3 格傘的位置聚起來
    f3 = frame(3); m3 = np.asarray(f3)[..., 3] > 40
    body = premul_blend(frame(1), f3, 0.35)
    gx, gy = 384, 250
    out2 = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    out2.alpha_composite(glow(gx, gy, 0.55, 150, (W, W)))
    out2.alpha_composite(body)
    out2.alpha_composite(sparkles(gx, gy, 34, 150, 2, 2.6, (W, W)))
    out2.save(os.path.join(HERE, 'rain49_f02.png'))
    print('02 glow')
    only = set(int(x) for x in sys.argv[2].split(',')) if len(sys.argv) > 2 else None
    jobs = [(10, 11, (-4, 1, 1, 20, -25)), (9, 'rain49_f10.png', (-8, 1, 1, 10, -20)),
            # 祐看過：29 只是比 28 稍微抬起來，借 28 才接得上傘邊；30 借 8（傘骨才對得上）
            (28, 27, (-4, 1, 1, 10, -30)), (29, 'rain49_f28.png', (-5, 1, 1, 0, -15)),
            (8, 31, (0, 1.15, 0.8, 0, -120)), (30, 'rain49_f08.png', (0, 1, 1, 0, -20))]
    for tn, sn, p0 in jobs:
        if only and tn not in only:
            continue
        transplant(tn, sn, p0)

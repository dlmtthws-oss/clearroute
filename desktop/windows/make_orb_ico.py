from PIL import Image
import math

S = 256
cx = cy = S / 2.0
R_body = 100.0   # orb radius
R_glow = 126.0   # outer glow radius

# Brand palette (matches the app's Jarvis orb: brand teal on deep navy).
# Radial colour stops from centre (t=0) to edge (t=1).
stops = [
    (0.00, (150, 246, 234)),  # bright teal core
    (0.38, (25, 214, 194)),   # brand teal  #19d6c2
    (0.82, (10, 80, 120)),    # deep teal-navy
    (1.00, (8, 48, 104)),     # ClearRoute navy  #083068
]
GLOW = (25, 214, 194)         # teal halo

def lerp(a, b, t):
    return a + (b - a) * t

def colour_at(t):
    if t <= stops[0][0]:
        return stops[0][1]
    for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
        if t <= t1:
            f = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
            return tuple(int(round(lerp(c0[i], c1[i], f))) for i in range(3))
    return stops[-1][1]

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
px = img.load()

# Light direction for a soft top-left highlight.
hlx, hly = cx - 34, cy - 40

for y in range(S):
    for x in range(S):
        dx = x - cx
        dy = y - cy
        d = math.hypot(dx, dy)
        if d <= R_body:
            t = d / R_body
            r, g, b = colour_at(t)
            # soft specular highlight, strongest near hlx/hly
            hd = math.hypot(x - hlx, y - hly)
            h = max(0.0, 1.0 - hd / 70.0) ** 2 * 90.0
            r = min(255, int(r + h)); g = min(255, int(g + h)); b = min(255, int(b + h))
            # anti-alias the body edge
            a = 255 if d <= R_body - 1 else int(255 * (R_body - d))
            px[x, y] = (r, g, b, max(0, min(255, a)))
        elif d <= R_glow:
            g01 = (d - R_body) / (R_glow - R_body)
            a = int(150 * (1 - g01) ** 2)
            px[x, y] = (GLOW[0], GLOW[1], GLOW[2], max(0, a))

out = "/home/user/clearroute/desktop/windows/jarvis.ico"
img.save(out, format="ICO", sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)])
print("wrote", out)

# Also emit a PNG preview so it can be eyeballed without extracting the ico.
img.save("/home/user/clearroute/desktop/windows/jarvis-orb-preview.png", format="PNG")
print("wrote preview png")

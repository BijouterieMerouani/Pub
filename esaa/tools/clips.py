"""Index of the event footage: short id -> uploaded file."""
import glob, os, re

UPLOADS = os.environ.get("ESAA_UPLOADS", "/root/.claude/uploads/cdd18b16-4118-5ec9-9117-31f38cc25f6d")

def index():
    out = {}
    for p in sorted(glob.glob(os.path.join(UPLOADS, "*"))):
        b = os.path.basename(p)
        m = re.match(r"^[0-9a-f]{8}-(?:IMG_)?(.+)\.(mov|MOV|mp4)$", b)
        if m:
            key = m.group(1)[:8]
            out.setdefault(key, p)   # duplicates (same name re-sent) keep the first
    return out

PHOTOS = {  # sender's names, in the order they were shared
    "6920": "4ed961d1-image.jpg", "6921": "3347f0db-image.jpg", "6922": "68323eb1-image.jpg",
    "6923": "2bd816a7-image.jpg", "6924": "3da7a078-image.jpg", "6925": "d0ad33a2-image.jpg",
    "6926": "aa18b9d2-image.jpg", "6928": "c96aa8b3-image.jpg", "6929": "23901c3c-image.jpg",
    "lego": "afa798ac-image.jpg",   # verticale : pouce levé devant le train en Lego
}
def photo(key):
    return os.path.join(UPLOADS, PHOTOS[key])

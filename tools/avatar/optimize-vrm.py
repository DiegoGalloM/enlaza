"""
Achica el modelo VRM del avatar sin tocar su geometría, huesos ni extensiones
(D49). Reescribe solo imágenes dentro del GLB:
- la miniatura (meta.thumbnailImage, no se dibuja nunca) pasa a 64×64;
- las texturas más grandes que --max (por defecto 1024 px de lado) se reducen
  a ese tamaño, salvo las de color de piel/ropa listadas en KEEP;
- todas las PNG se vuelven a comprimir (optimize).
Uso: python optimize-vrm.py <entrada.vrm> <salida.vrm> [--max=1024]
Requiere Pillow.
"""
import io, json, struct, sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
max_side = int(next((a.split('=')[1] for a in sys.argv[3:] if a.startswith('--max=')), 1024))
# Texturas de color que se dejan a su tamaño: la piel del cuerpo (la mano en
# primer plano) y la ropa se ven de cerca en el panel.
KEEP = {'Body_00', 'Tops_01'}

data = open(src, 'rb').read()
magic, version, _ = struct.unpack('<III', data[:12])
assert magic == 0x46546C67, 'no es un GLB'
json_len, json_type = struct.unpack('<II', data[12:20])
gltf = json.loads(data[20:20 + json_len])
bin_len, bin_type = struct.unpack('<II', data[20 + json_len:28 + json_len])
binary = data[28 + json_len:28 + json_len + bin_len]

views = gltf['bufferViews']
thumbnail = gltf.get('extensions', {}).get('VRMC_vrm', {}).get('meta', {}).get('thumbnailImage')
replacements = {}
for i, image in enumerate(gltf['images']):
    view = views[image['bufferView']]
    raw = binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]
    img = Image.open(io.BytesIO(raw))
    name = image.get('name', '')
    if i == thumbnail:
        img = img.convert('RGB').resize((64, 64), Image.LANCZOS)
    elif max(img.size) > max_side and name not in KEEP:
        scale = max_side / max(img.size)
        img = img.resize((round(img.size[0] * scale), round(img.size[1] * scale)), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, format='PNG', optimize=True)
    new = out.getvalue()
    if len(new) < len(raw):
        replacements[image['bufferView']] = new
        print(f'{name:20} {len(raw):>9} -> {len(new):>9}  {img.size}')
    else:
        print(f'{name:20} {len(raw):>9}    (igual)')

# Reconstruir el BIN con los bufferViews en el mismo orden, alineados a 4 bytes.
chunks = []
offset = 0
for index, view in enumerate(views):
    start = view.get('byteOffset', 0)
    payload = replacements.get(index, binary[start:start + view['byteLength']])
    pad = (-offset) % 4
    if pad:
        chunks.append(b'\0' * pad)
        offset += pad
    view['byteOffset'] = offset
    view['byteLength'] = len(payload)
    chunks.append(payload)
    offset += len(payload)
new_bin = b''.join(chunks)
new_bin += b'\0' * ((-len(new_bin)) % 4)
gltf['buffers'][0]['byteLength'] = len(new_bin)

json_bytes = json.dumps(gltf, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
json_bytes += b' ' * ((-len(json_bytes)) % 4)
total = 12 + 8 + len(json_bytes) + 8 + len(new_bin)
with open(dst, 'wb') as f:
    f.write(struct.pack('<III', magic, version, total))
    f.write(struct.pack('<II', len(json_bytes), json_type))
    f.write(json_bytes)
    f.write(struct.pack('<II', len(new_bin), bin_type))
    f.write(new_bin)
print(f'{len(data)} -> {total} bytes ({100 * total / len(data):.0f}%)')

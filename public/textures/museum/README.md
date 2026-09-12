# Museum concrete materials

These texture assets were downloaded from the publishers' official endpoints on
2026-09-12. Both sources release their downloadable assets under CC0 1.0 Universal,
including commercial use, modification, and redistribution in an application.
The image files below are unmodified downloads, renamed for the museum renderer.

## Wall: Poly Haven — Concrete Wall 009

- Asset: https://polyhaven.com/a/concrete_wall_009
- Author: Charlotte Baglioni
- Publisher license: https://polyhaven.com/license
- License text: https://creativecommons.org/publicdomain/zero/1.0/
- Download metadata: https://api.polyhaven.com/files/concrete_wall_009
- Resolution: 2048 × 2048 pixels for all three maps.
- Published physical width: 1.8 m. The image tile is square.
- Appearance: cast concrete with formwork seams, tie-bolt marks, and small pores.
  Its source albedo has a warm gray cast; the scene controls the final lighting.
- Combined download size for the three retained JPEGs: 7,868,989 bytes (7.87 MB).

| Local file | Map | Original direct download | Bytes |
| --- | --- | --- | ---: |
| `concrete-wall-albedo.jpg` | Diffuse/albedo | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/concrete_wall_009/concrete_wall_009_diff_2k.jpg | 2,573,465 |
| `concrete-wall-normal.jpg` | OpenGL normal | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/concrete_wall_009/concrete_wall_009_nor_gl_2k.jpg | 2,229,634 |
| `concrete-wall-roughness.jpg` | Roughness | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/concrete_wall_009/concrete_wall_009_rough_2k.jpg | 3,065,890 |

## Floor: ambientCG — Concrete 014

- Asset: https://ambientcg.com/view?id=Concrete014
- Publisher/creator: ambientCG / Lennart Demes
- Publisher license: https://docs.ambientcg.com/license/
- License text: https://creativecommons.org/publicdomain/zero/1.0/
- Official archive: https://ambientcg.com/get?file=Concrete014_1K-JPG.zip
- Resolution: 1024 × 1024 pixels for all three maps.
- The publisher does not list a physical tile size for this procedural asset;
  the museum chooses its texture repeat in world units.
- Publisher tags: Clean, Concrete, Light, Smooth. The albedo is neutral gray,
  with broad tonal variation and fine surface marks rather than large cracks.
- A honed floor appearance is an artistic material calibration in the renderer,
  not a claimed scanned finish of this source asset.
- Downloaded archive size: 7,610,650 bytes (7.61 MB). Only the three needed maps
  are retained, totaling 3,543,512 bytes (3.54 MB).

| Local file | Map | Original archive member | Bytes |
| --- | --- | --- | ---: |
| `concrete-floor-albedo.jpg` | Color/albedo | `Concrete014_1K-JPG_Color.jpg` | 879,492 |
| `concrete-floor-normal.jpg` | OpenGL normal | `Concrete014_1K-JPG_NormalGL.jpg` | 2,083,275 |
| `concrete-floor-roughness.jpg` | Roughness | `Concrete014_1K-JPG_Roughness.jpg` | 580,745 |

## Renderer integration

Load the albedo maps with the sRGB color space. Normal and roughness textures
contain linear data and should retain `NoColorSpace`. Both normal maps use the
OpenGL convention. The complete retained wall and floor set is 11.41 MB.

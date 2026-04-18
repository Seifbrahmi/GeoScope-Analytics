import rasterio
import numpy as np
from PIL import Image
from rasterio.windows import Window

print("SCRIPT STARTED")

file_path = "data/firecci/20210601-ESACCI-L3S_FIRE-BA-MODIS-AREA_1-fv5.1-CL.tif"

with rasterio.open(file_path) as src:
    print("CRS:", src.crs)
    print("Resolution:", src.res)
    print("Width x Height:", src.width, src.height)
    print("Number of bands:", src.count)

    # 🔥 read small subset ONLY
    window = Window(0, 0, 1000, 1000)
    data = src.read(1, window=window)

print("Data loaded (subset)")

print("Min value:", data.min())
print("Max value:", data.max())

# burned mask
burned = data > 0

# normalize safely
norm = (data / data.max() * 255).astype(np.uint8)
burned_img = (burned * 255).astype(np.uint8)

Image.fromarray(norm).save("raw_data.png")
Image.fromarray(burned_img).save("burned.png")

print("Images saved successfully")
import exifr from 'exifr';
import { pointSchema } from './domain.mjs';

export async function readPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image under 20 MB.');
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 80_000_000)
      throw new Error('This image is too large to process. Export a smaller version.');
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    let exif = {};
    let metadataWarning = '';
    try {
      exif = (await exifr.parse(file, { gps: true, tiff: true, exif: true })) || {};
    } catch {
      metadataWarning = 'Some metadata could not be read.';
    }
    const gps = pointSchema.safeParse({ lat: exif.latitude, lng: exif.longitude });
    return {
      photo: canvas.toDataURL('image/jpeg', 0.86),
      gps: gps.success ? gps.data : null,
      fileName: file.name.slice(0, 300),
      metadata: {
        Dimensions: `${image.naturalWidth} × ${image.naturalHeight}`,
        'Original size': `${(file.size / 1024 / 1024).toFixed(2)} MB`,
        Camera: [exif.Make, exif.Model].filter(Boolean).join(' ') || 'Not embedded',
        'Capture date':
          exif.DateTimeOriginal instanceof Date
            ? exif.DateTimeOriginal.toLocaleString()
            : 'Not embedded',
        GPS: gps.success
          ? `${gps.data.lat.toFixed(6)}, ${gps.data.lng.toFixed(6)}`
          : 'Not embedded',
        ...(metadataWarning ? { Note: metadataWarning } : {}),
      },
    };
  } catch (error) {
    if (error.name === 'EncodingError')
      throw new Error('This image could not be decoded. Try another file.');
    throw error;
  } finally {
    URL.revokeObjectURL(source);
  }
}

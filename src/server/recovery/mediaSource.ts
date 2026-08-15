import type { MediaAsset } from "../database/mediaRepository";
import { DELIVERY_HOST } from "../media/config";
import { fetchDeliveredImage } from "../media/fetchImage";
import { detectImageFormat } from "../media/imageSignature";
import type { MediaOriginalSource } from "./recovery";

function encodedPublicId(publicId: string): string {
  const segments = publicId.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === ".."
    )
  ) {
    throw new Error("Media public ID is not safe to download");
  }
  return segments.map(encodeURIComponent).join("/");
}

export class CloudinaryOriginalSource implements MediaOriginalSource {
  constructor(
    private readonly cloudName: string,
    private readonly maxBytes: number
  ) {}

  async download(asset: MediaAsset): Promise<{
    bytes: Uint8Array;
    format: "jpg" | "png" | "webp";
  }> {
    if (
      asset.status !== "ready" ||
      asset.providerVersion === null ||
      asset.format === null
    ) {
      throw new Error("Media asset has no recoverable provider original");
    }
    const url =
      `https://${DELIVERY_HOST}/${encodeURIComponent(this.cloudName)}` +
      `/image/upload/v${encodeURIComponent(asset.providerVersion)}` +
      `/${encodedPublicId(asset.providerPublicId)}.${asset.format}`;
    const fetched = await fetchDeliveredImage(url, {
      maxBytes: this.maxBytes,
    });
    if (fetched.status !== "ok") {
      throw new Error("Cloudinary Media original is unavailable");
    }
    const detected = detectImageFormat(fetched.bytes, fetched.contentType);
    if (detected.status !== "ok") {
      throw new Error("Cloudinary Media original failed image validation");
    }
    return { bytes: fetched.bytes, format: detected.format };
  }
}

declare module "libheif-js/wasm-bundle" {
  type Handle = object;
  type Context = object;
  const libheif: {
    heif_context_alloc(): Context;
    heif_context_free(context: Context): void;
    heif_context_read_from_memory(context: Context, data: Uint8Array): { code: { value: number }; message: string };
    heif_js_context_get_image_handle(context: Context, id: number): Handle | null;
    heif_image_handle_release(handle: Handle): void;
    heif_js_decode_image2(handle: Handle, colorspace: unknown, chroma: unknown): {
      code?: { value: number };
      image: object;
      width: number;
      height: number;
      channels: { id: unknown; stride: number; data: Uint8Array; width: number; height: number }[];
    };
    heif_image_release(image: object): void;
    heif_colorspace_RGB: unknown;
    heif_chroma_interleaved_RGBA: unknown;
    heif_channel_interleaved: unknown;
    heif_error_Ok: { value: number };
  };
  export default libheif;
}
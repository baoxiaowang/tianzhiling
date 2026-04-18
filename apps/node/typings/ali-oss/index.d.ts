declare module 'ali-oss' {
  interface OssClientOptions {
    region: string;
    bucket: string;
    accessKeyId: string;
    accessKeySecret: string;
    endpoint?: string;
    stsToken?: string;
    timeout?: number;
    secure?: boolean;
  }

  interface OssSignatureUrlOptions {
    method?: string;
    expires?: number;
    'Content-Type'?: string;
  }

  interface OssPutOptions {
    headers?: Record<string, string>;
  }

  class OSS {
    constructor(options: OssClientOptions);

    put(
      name: string,
      file: string | Buffer | NodeJS.ReadableStream,
      options?: OssPutOptions
    ): Promise<unknown>;

    generateObjectUrl(name: string, baseUrl?: string): string;

    signatureUrl(
      name: string,
      options?: OssSignatureUrlOptions,
      strictObjectNameValidation?: boolean
    ): string;
  }

  export = OSS;
}

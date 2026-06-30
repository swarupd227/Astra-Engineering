declare module 'html-to-docx' {
  function HTMLToDocx(html: string, header?: string, options?: any): Promise<Buffer>;
  export = HTMLToDocx;
}


import * as M from "monaco-editor";

const store: any = {};
let themeNo = 0;

export default async function setTheme(src: any) {
    const name = `--theme-${++themeNo}`;
    if (typeof src !== 'string') store[name] = src;
    else store[name] = await fetch(src);
    src = name;
    M.editor.defineTheme(src, store[src]);
    M.editor.setTheme(src);
}
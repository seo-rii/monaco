import * as M from "monaco-editor";

const store: any = {};
let themeNo = 0;

export default async function setTheme(src: any) {
    if (typeof src !== 'string') {
        const name = `__theme_${++themeNo}`;
        store[name] = src;
        src = name;
    }
    const res = store[src] = (store[src] || await fetch(src));
    M.editor.defineTheme(src, res);
    M.editor.setTheme(src);
}
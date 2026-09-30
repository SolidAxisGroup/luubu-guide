// Builds a single injectable file with tours inlined, for testing without hosting.
const fs=require('fs'),p=require('path');const T=p.join(__dirname,'..','tours');
const ix=JSON.parse(fs.readFileSync(p.join(T,'index.json')));
const tours=ix.tours.map(t=>Object.assign({},t,JSON.parse(fs.readFileSync(p.join(T,t.id+'.json')))));
const loc=process.argv[2]||'zRK0moceMCOayumGoB8R';
let g=fs.readFileSync(p.join(__dirname,'..','src','guide.js'),'utf8');
const out=`window.__luubuGuide&&window.__luubuGuide.stop&&window.__luubuGuide.stop();delete window.__luubuGuide;var __h=document.getElementById('luubu-guide-root');if(__h)__h.remove();\nwindow.LUUBU_GUIDE_CONFIG=${JSON.stringify({locations:[loc],tours})};\n`+g;
fs.writeFileSync(p.join(__dirname,'test-bundle.js'),out);console.log('bytes',out.length);

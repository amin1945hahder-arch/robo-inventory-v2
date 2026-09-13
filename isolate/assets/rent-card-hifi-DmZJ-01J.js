import{N as x}from"./index-KthMAr4H.js";async function C(n){return x.toCanvas(n,{scale:3,fast:!1})}function R(n){const e=n.slice(n.indexOf(",")+1),s=atob(e),a=new Uint8Array(s.length);for(let o=0;o<s.length;o++)a[o]=s.charCodeAt(o);return a}function w(n,e,s){const a=e*.75,o=s*.75,c=`q ${a.toFixed(2)} 0 0 ${o.toFixed(2)} 0 0 cm /Im0 Do Q`,i=new TextEncoder,m=t=>`5 0 obj
<< /Type /XObject /Subtype /Image /Width ${e} /Height ${s} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${t} /Length ${n.length} >>
stream
`,l=[],p=[];let f=0;const r=t=>{const d=typeof t=="string"?i.encode(t):t;p.push(f),l.push(d),f+=d.length};r(`%PDF-1.4
`),r(`1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
`),r(`2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
`),r(`3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${a.toFixed(2)} ${o.toFixed(2)}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 6 0 R >>
endobj
`),r(`4 0 obj
<< >>
endobj
`),r(m("DCTDecode")),r(n),r(`
endstream
endobj
`),r(`6 0 obj
<< /Length ${c.length} >>
stream
${c}
endstream
endobj
`);const j=f;let b=`xref
0 7
0000000000 65535 f 
`;for(let t=0;t<6;t++)b+=`${String(p[t]).padStart(10,"0")} 00000 n 
`;b+=`trailer
<< /Size 7 /Root 1 0 R >>
startxref
${j}
%%EOF
`,r(b);const y=l.reduce((t,d)=>t+d.length,0),h=new Uint8Array(y);let g=0;for(const t of l)h.set(t,g),g+=t.length;return h}async function u(n){const e=await C(n),s=e.toDataURL("image/jpeg",.92),a=R(s);return{pdf:w(a,e.width,e.height),widthPx:e.width,heightPx:e.height}}async function T(n,e){const{pdf:s}=await u(n),a=new Blob([s],{type:"application/pdf"}),o=URL.createObjectURL(a),c=document.createElement("a");c.href=o,c.download=e,document.body.appendChild(c),c.click(),c.remove(),setTimeout(()=>URL.revokeObjectURL(o),3e4)}async function $(n){const{pdf:e,widthPx:s,heightPx:a}=await u(n);let o="";const c=32768;for(let i=0;i<e.length;i+=c)o+=String.fromCharCode(...e.subarray(i,i+c));return{base64:btoa(o),widthPx:s,heightPx:a}}export{T as d,$ as e};

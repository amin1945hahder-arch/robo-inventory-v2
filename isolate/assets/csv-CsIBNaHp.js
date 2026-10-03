function r(e){return`\uFEFF${e.map(o=>o.map(n=>`"${String(n).replace(/"/g,'""')}"`).join(",")).join(`
`)}`}function s(e,t){const o=t.startsWith("\uFEFF")?t:`\uFEFF${t}`,n=new Blob([o],{type:"text/csv;charset=utf-8"}),a=URL.createObjectURL(n),c=document.createElement("a");c.href=a,c.download=e,c.click(),setTimeout(()=>URL.revokeObjectURL(a),15e3)}export{s as d,r as t};

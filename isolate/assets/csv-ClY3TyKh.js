function c(e){return`\uFEFF${e.map(o=>o.map(t=>`"${String(t).replace(/"/g,'""')}"`).join(",")).join(`
`)}`}function a(e,n){const o=new Blob([n],{type:"text/csv;charset=utf-8"}),t=document.createElement("a");t.href=URL.createObjectURL(o),t.download=e,t.click(),URL.revokeObjectURL(t.href)}export{a as d,c as t};

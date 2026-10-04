import{c}from"./index-JFUzjcZJ.js";const u=[["path",{d:"M12 3v18",key:"108xh3"}],["path",{d:"M3 12h18",key:"1i2n21"}],["rect",{x:"3",y:"3",width:"18",height:"18",rx:"2",key:"h1oib"}]],y=c("grid-2x2",u);const f=[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],k=c("loader-circle",f);function b(a,i){return i==="landscape"?{w:a.h,h:a.w}:{...a}}function x({paper:a,orientation:i,marginMm:l}){const{w:p,h:o}=b(a,i);return`
@media print {
  @page { size: ${p}mm ${o}mm; margin: 0; }
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }

  /* Isolate the sheet: hide every node except #print-area, its subtree and
     its ancestors — the app shell stops contributing pages entirely. */
  @supports selector(:has(*)) {
    body *:not(#print-area):not(#print-area *):not(:has(#print-area)) { display: none !important; }
  }

  /* The paper wrapper: unclip, unborder, let content define page breaks. */
  :has(> #print-area) {
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
    border: none !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
  }

  /* True physical scale: mm() resolves to real mm, transforms are dropped. */
  #print-area {
    position: static !important;
    inset: auto !important;
    width: auto !important;
    max-width: none !important;
    height: auto !important;
    overflow: visible !important;
    padding: 0 !important;
    margin: 0 !important;
    background: #fff !important;
    --mm: 1mm !important;
  }

  /* Explicit page breaks: one .print-page div = one physical sheet. The
     inline display:none used by the on-screen pager is overridden here, so
     EVERY prepared page prints — not just the previewed one. */
  .print-page {
    display: block !important;
    position: relative !important;
    inset: auto !important;
    break-after: page !important;
    page-break-after: always !important;
    background: #fff !important;
  }
  .print-page:last-child {
    break-after: auto !important;
    page-break-after: auto !important;
  }
  /* Fixed pages (labels/cards) are sized exactly — anything a rounding
     fraction could spill is clipped HERE instead of creating an extra
     half-empty sheet. */
  .print-page--fixed { overflow: hidden !important; }
  .print-page--flow { overflow: visible !important; }

  /* Screen-only preview chunks never print; the print-only full copies do. */
  .preview-only { display: none !important; }
  .print-full { display: block !important; }

  .no-print { display: none !important; }

  /* Rows/labels never split across pages; scaled cells print at true size. */
  #print-area .print-cell,
  #print-area .print-label,
  #print-area .print-card {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  #print-area tr { break-inside: avoid !important; page-break-inside: avoid !important; }
  #print-area .print-cell > div > div { transform: none !important; }
  #print-area section h2 { break-after: avoid; page-break-after: avoid; }
}
`}function C(a,i,l={}){const p=l.sectionGapMm??0,o=[];let t=[],s=0;const d=()=>{t.length>0&&(o.push(t),t=[],s=0)},m=(e,r)=>{const n=t[t.length-1];n&&n.sectionId===e&&n.fromRow+n.rowCount===r?n.rowCount+=1:t.push({sectionId:e,fromRow:r,rowCount:1})};for(const e of a){if(e.rows<=0)continue;const r=e.headerH??0;for(let n=0;n<e.rows;n++){const h=(t.length>0&&t[t.length-1].sectionId===e.id?0:(t.length>0?p:0)+r)+e.rowPitch;s+h>i&&t.length>0&&d();const g=t.length>0&&t[t.length-1].sectionId===e.id;s+=(g?0:r)+e.rowPitch,m(e.id,n)}}return d(),o}export{y as G,k as L,b as o,C as p,x as s};

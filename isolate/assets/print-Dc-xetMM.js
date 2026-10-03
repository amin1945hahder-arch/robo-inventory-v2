import{c as o}from"./index-DiYOAzLc.js";const p=[["path",{d:"M12 3v18",key:"108xh3"}],["path",{d:"M3 12h18",key:"1i2n21"}],["rect",{x:"3",y:"3",width:"18",height:"18",rx:"2",key:"h1oib"}]],d=o("grid-2x2",p);function s(t,a){return a==="landscape"?{w:t.h,h:t.w}:{...t}}function h({paper:t,orientation:a,marginMm:r}){const{w:e,h:i}=s(t,a),n=Math.max(0,r);return`
@media print {
  @page { size: ${e}mm ${i}mm; margin: ${n}mm; }
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

  /* True physical scale: mm() resolves to real mm, transforms are dropped,
     and the sheet starts at the page margin (no double margin). */
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

  .no-print { display: none !important; }

  /* Rows/labels never split across pages; scaled cells print at true size. */
  #print-area .print-cell,
  #print-area .print-label,
  #print-area .print-card {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  #print-area .print-cell > div > div { transform: none !important; }
  #print-area section h2 { break-after: avoid; page-break-after: avoid; }
}
`}export{d as G,s as o,h as s};

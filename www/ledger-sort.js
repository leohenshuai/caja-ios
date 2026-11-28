/* 排序偏好独立保存，不重排/改写账目、金额和时间。序号始终表示该组时间先后。 */
const DETAIL_SORT_MODES = [['time-asc','时间：从早到晚'],['time-desc','时间：从晚到早'],['amount-asc','金额：从小到大'],['amount-desc','金额：从大到小'],['manual','手动调整']];
function detailTimeCompare(a,b) { return (Number(a.ts)||0)-(Number(b.ts)||0) || String(a.id).localeCompare(String(b.id)); }
function detailSortKey(book,type) { return JSON.stringify([book,state.curDate,type]); }
function getDetailSort(book,type) {
 const config=state.detailSort[detailSortKey(book,type)];
 return config && DETAIL_SORT_MODES.some(x=>x[0]===config.mode) ? config : {mode:'time-asc',ids:[]};
}
function sortDetailRows(rows,config) {
 const out=rows.slice().sort(detailTimeCompare);
 if(config.mode==='manual') {
  const ids=Array.isArray(config.ids)?config.ids:[], order=new Map(ids.map((id,i)=>[id,i]));
  return out.sort((a,b)=>(order.get(a.id)??Infinity)-(order.get(b.id)??Infinity)||detailTimeCompare(a,b));
 }
 if(config.mode==='time-desc')out.reverse();
 if(config.mode.startsWith('amount-'))out.sort((a,b)=>(Number(a.amount)-Number(b.amount))*(config.mode==='amount-asc'?1:-1)||detailTimeCompare(a,b));
 return out;
}
function detailSortControls(book,type,mode) {
 return '<label class="lg-detail-sort"><span>排序 · 序号按时间</span><select data-detail-sort data-book="'+escHtml(book)+'" data-type="'+type+'" aria-label="'+(type==='out'?'支出':'收入')+'排序">'+DETAIL_SORT_MODES.map(([v,t])=>'<option value="'+v+'"'+(mode===v?' selected':'')+'>'+t+'</option>').join('')+'</select></label>';
}
function detailMoveControls(e,book,type,index,count) {
 const base=' data-detail-move data-book="'+escHtml(book)+'" data-type="'+type+'" data-entry="'+escHtml(e.id)+'"';
 return '<div class="lg-detail-move"><button type="button"'+base+' data-step="-1"'+(index===0?' disabled':'')+'>↑ 上移</button><button type="button"'+base+' data-step="1"'+(index===count-1?' disabled':'')+'>↓ 下移</button></div>';
}
let detailSortBusy=false;
async function storeDetailSort(book,type,config) {
 if(detailSortBusy)return;
 detailSortBusy=true;
 const key=detailSortKey(book,type), before=state.detailSort[key];
 state.detailSort[key]=config;
 try {
  if(!await saveKey('detailSort')){if(before===undefined)delete state.detailSort[key];else state.detailSort[key]=before;}
 }finally{detailSortBusy=false;renderList(book);}
}
document.addEventListener('change',async e=>{
 const el=e.target.closest('[data-detail-sort]'); if(!el)return;
 const {book,type}=el.dataset, mode=el.value;
 if(!DETAIL_SORT_MODES.some(x=>x[0]===mode))return;
 const config=getDetailSort(book,type);
 const rows=sortDetailRows(dayEntries(book,state.curDate).filter(x=>x.type===type),config);
 await storeDetailSort(book,type,{mode,ids:mode==='manual'?rows.map(x=>x.id):config.ids||[]});
});
document.addEventListener('click',async e=>{
 const el=e.target.closest('[data-detail-move]');if(!el||el.disabled||detailSortBusy)return;
 const {book,type,entry}=el.dataset,config=getDetailSort(book,type);
 if(config.mode!=='manual')return;
 const rows=sortDetailRows(dayEntries(book,state.curDate).filter(x=>x.type===type),config);
 const i=rows.findIndex(x=>x.id===entry), j=i+Number(el.dataset.step);
 if(i<0||j<0||j>=rows.length)return;
 [rows[i],rows[j]]=[rows[j],rows[i]];
 await storeDetailSort(book,type,{mode:'manual',ids:rows.map(x=>x.id)});
});

import http from 'http';
http.createServer((req,res)=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{
  const body=JSON.parse(b); const u=body.messages[0].content; let out;
  if (body.system.includes('anchor')) { const j=JSON.parse(u); const c=j.candidates.find(c=>c.id&&/websites|email-builder/.test(c.id)); out=c?{strategy:{css:'#'+c.id},confidence:0.93,reason:'id changed, same label'}:{confidence:0}; }
  else out={lookFor:'Stub label',title:'Stub',body:'Stub',confidence:0.5,reason:'stub'};
  res.setHeader('content-type','application/json'); res.end(JSON.stringify({content:[{type:'text',text:JSON.stringify(out)}]}));
});}).listen(8766,()=>console.log('stub up'));

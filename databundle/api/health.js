const {DB}=require('./_core');
module.exports=async(_req,res)=>{try{await DB.list();res.status(200).send('ok');}catch(e){res.status(503).send('database unavailable');}};


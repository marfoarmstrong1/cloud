const {packages,NETWORKS}=require('./_core');
module.exports=async(req,res)=>{if(req.method!=='GET')return res.status(405).end();const net=req.query.network;if(!NETWORKS.includes(net))return res.status(400).json({error:'Unknown network'});try{res.json({packages:(await packages(net)).sort((a,b)=>a.size_gb-b.size_gb)});}catch(e){res.status(502).json({error:e.message});}};

const m=require('mongoose');const fs=require('fs');const t=fs.readFileSync('.env','utf8');
for(const l of t.split('\n')){const mt=l.match(/^([A-Z_]+)=(.*)$/);if(mt)process.env[mt[1]]=mt[2].trim();}
m.connect(process.env.MONGODB_URI).then(async()=>{
  const U=m.model('User',new m.Schema({},{strict:false}),'users');
  const O=m.model('Order',new m.Schema({},{strict:false}),'orders');
  const T=m.model('Table',new m.Schema({},{strict:false}),'tables');
  const W=m.model('TipWithdrawal',new m.Schema({},{strict:false}),'tipwithdrawals');
  // Delete non-seed staff/chef accounts (keep admin@, chef@, staff@, staff2@)
  const seed=['admin@restaurant.com','chef@restaurant.com','staff@restaurant.com','staff2@restaurant.com'];
  await U.deleteMany({email:{$nin:seed},role:{$in:['chef','staff']}});
  await O.deleteMany({});
  await T.updateMany({},{$unset:{currentSession:''}});
  await U.updateMany({role:{$in:['chef','staff']}},{$set:{lastActiveAt:null,lastAssignedAt:null,tipsEarned:0,tipsWithdrawn:0}});
  await W.deleteMany({});
  console.log('full clean done');
  process.exit(0);
});

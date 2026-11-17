(function(){
  'use strict';
  var cs=new CSInterface(),get=function(id){return document.getElementById(id);},status=get('status');
  function say(t,ok){status.textContent=t;status.className=ok?'ok':'error';}
  function value(id){var n=Number(get(id).value);if(!isFinite(n)||n<=0){throw Error('اندازه‌ها باید عدد مثبت باشند.');}return n;}
  function direct(){
    var code=get('code').value.trim(),w=value('w'),h=value('h'),q=value('qty'),tile=value('tile');
    if(q!==Math.floor(q)||q>100){throw Error('تعداد باید عدد صحیح بین ۱ تا ۱۰۰ باشد.');}
    if(!code||!get('root').value.trim()){throw Error('پوشهٔ کتابخانه و کد نقش لازم است.');}
    return {format:'naqsh-direct',version:1,libraryRoot:get('root').value.trim(),project:{version:1,name:'قطعه '+code,sheet:{widthMm:w+40,heightMm:h+40,autoHeight:true,gutterMm:12,marginMm:20},sections:[{id:'direct',name:'قطعه '+code,widthMm:w,heightMm:h,quantity:q,shape:'rect',mirror:false,layers:[{id:'motif',name:code,code:code,enabled:true,xMm:0,yMm:0,widthMm:w,heightMm:h,mode:get('mode').value,tileWidthMm:tile,lockAspect:true,gapXmm:-0.2,gapYmm:-0.2,offsetXmm:0,offsetYmm:0,rotation:0,mirrorX:false,mirrorY:false,opacity:1}]}]}};
  }
  function response(r){say(r||'پاسخی از Illustrator نرسید.',String(r).indexOf('OK:')===0);}
  get('open').onclick=function(){try{var raw=get('exchange').value.trim(),entry=raw?'Naqsh_import':'Naqsh_importDirect',obj=raw?JSON.parse(raw):direct();say('در حال ساخت سند جدید…',true);cs.evalScript(entry+'('+JSON.stringify(JSON.stringify(obj))+')',response);}catch(e){say(e.message||String(e),false);}};
  get('file').onclick=function(){cs.evalScript('Naqsh_openExchange()',response);};
  get('chooseRoot').onclick=function(){cs.evalScript('Naqsh_chooseLibraryRoot()',function(r){if(r&&r!=='EvalScript error.'){get('root').value=r;say('پوشه انتخاب شد.',true);}});};
  get('clear').onclick=function(){get('exchange').value='';say('متن پاک شد؛ حالت مستقیم فعال است.',true);};
  say('آماده؛ کتابخانه را انتخاب کنید یا فایل تبادل وب را وارد کنید.',true);
}());

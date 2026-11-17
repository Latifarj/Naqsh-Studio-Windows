/* Naqsh Studio native importer. ES3 / ExtendScript. Library only: run standalone.jsx. */
(function (g) {
  var PT = 72 / 25.4, MAX_MM = 5779, MAX_COUNT = 10000, MAX_TEXT = 80 * 1024 * 1024;
  var MAX_ASSET = 20 * 1024 * 1024, MAX_TOTAL = 64 * 1024 * 1024;
  function fail(s) { throw new Error('نقش‌یار: ' + s); }
  function own(o,k) { return o && Object.prototype.hasOwnProperty.call(o,k); }
  function array(a) { return Object.prototype.toString.call(a) === '[object Array]'; }
  function num(v,label) { if ((typeof v !== 'number' && typeof v !== 'string') || v === '') { fail(label + ' عدد معتبر نیست.'); } var n=Number(v); if(!isFinite(n)){fail(label+' عدد معتبر نیست.');}return n; }
  function positive(v,label) { var n=num(v,label);if(n<=0){fail(label+' باید مثبت باشد.');}return n; }
  function code(c) { c=String(c||'');if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(c)){fail('کد نقش نامعتبر است.');}return c; }
  function pt(mm) { return Number(mm)*PT; }
  function topY(y) { return -pt(y); }

  /* Strict JSON fallback, without eval and with bounded nesting. */
  function Parser(text) {
    this.s=text;this.i=0;this.depth=0;
    this.ws=function(){while(this.i<this.s.length&&/[\x20\t\r\n]/.test(this.s.charAt(this.i))){this.i++;}};
    this.err=function(){fail('JSON نامعتبر در موقعیت '+this.i);};
    this.string=function(){var out='',c,h,map={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};if(this.s.charAt(this.i++)!=='"'){this.err();}while(this.i<this.s.length){c=this.s.charAt(this.i++);if(c==='"'){return out;}if(c==='\\'){c=this.s.charAt(this.i++);if(c==='u'){h=this.s.substr(this.i,4);if(!/^[0-9a-f]{4}$/i.test(h)){this.err();}out+=String.fromCharCode(parseInt(h,16));this.i+=4;}else{if(!own(map,c)){this.err();}out+=map[c];}}else{if(c.charCodeAt(0)<32){this.err();}out+=c;}}this.err();};
    this.number=function(){var m=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(this.s.substr(this.i));if(!m){this.err();}this.i+=m[0].length;var n=Number(m[0]);if(!isFinite(n)){this.err();}return n;};
    this.arr=function(){var a=[];this.i++;this.ws();if(this.s.charAt(this.i)===']'){this.i++;return a;}while(true){a.push(this.value());this.ws();if(this.s.charAt(this.i)===']'){this.i++;return a;}if(this.s.charAt(this.i++)!==','){this.err();}}};
    this.obj=function(){var o={},k;this.i++;this.ws();if(this.s.charAt(this.i)==='}'){this.i++;return o;}while(true){this.ws();k=this.string();if(k==='__proto__'||k==='prototype'||k==='constructor'){fail('کلید JSON ناامن است.');}this.ws();if(this.s.charAt(this.i++)!==':'){this.err();}o[k]=this.value();this.ws();if(this.s.charAt(this.i)==='}'){this.i++;return o;}if(this.s.charAt(this.i++)!==','){this.err();}}};
    this.value=function(){var c,v;this.ws();this.depth++;if(this.depth>128){fail('عمق JSON بیش از حد است.');}c=this.s.charAt(this.i);if(c==='{'){v=this.obj();}else if(c==='['){v=this.arr();}else if(c==='"'){v=this.string();}else if(c==='-'||/[0-9]/.test(c)){v=this.number();}else if(this.s.substr(this.i,4)==='true'){this.i+=4;v=true;}else if(this.s.substr(this.i,5)==='false'){this.i+=5;v=false;}else if(this.s.substr(this.i,4)==='null'){this.i+=4;v=null;}else{this.err();}this.depth--;return v;};
  }
  function parse(s) { if(typeof s!=='string'||s.length>MAX_TEXT){fail('JSON خالی یا بیش از ۸۰MB است.');}s=s.replace(/^\uFEFF/,'');var p=new Parser(s),v=p.value();p.ws();if(p.i!==s.length){p.err();}if(!v||typeof v!=='object'||array(v)){fail('ریشه JSON باید شیء باشد.');}return v; }
  function quote(s) { return '"'+String(s).replace(/[\\"\u0000-\u001f]/g,function(c){var m={'\\':'\\\\','"':'\\"','\n':'\\n','\r':'\\r','\t':'\\t','\b':'\\b','\f':'\\f'},h;if(own(m,c)){return m[c];}h=c.charCodeAt(0).toString(16);return '\\u'+('0000'+h).slice(-4);})+'"'; }
  function stringify(v) { var a=[],i,k;if(v===null){return 'null';}if(typeof v==='string'){return quote(v);}if(typeof v==='number'){return isFinite(v)?String(v):'null';}if(typeof v==='boolean'){return String(v);}if(array(v)){for(i=0;i<v.length;i++){a.push(v[i]===undefined?'null':stringify(v[i]));}return '['+a.join(',')+']';}for(k in v){if(own(v,k)&&v[k]!==undefined&&typeof v[k]!=='function'){a.push(quote(k)+':'+stringify(v[k]));}}return '{'+a.join(',')+'}'; }

  var B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function decodeBase64(text) { var s=String(text).replace(/[\r\n\s]/g,''),out='',i,a,b,c,d;if(!s.length||s.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(s)){fail('base64 نامعتبر است.');}for(i=0;i<s.length;i+=4){a=B64.indexOf(s.charAt(i));b=B64.indexOf(s.charAt(i+1));c=s.charAt(i+2)==='='?0:B64.indexOf(s.charAt(i+2));d=s.charAt(i+3)==='='?0:B64.indexOf(s.charAt(i+3));if(a<0||b<0||c<0||d<0||(s.charAt(i+2)==='='&&s.charAt(i+3)!=='=')){fail('base64 نامعتبر است.');}out+=String.fromCharCode((a<<2)|(b>>4));if(s.charAt(i+2)!=='='){out+=String.fromCharCode(((b&15)<<4)|(c>>2));}if(s.charAt(i+3)!=='='){out+=String.fromCharCode(((c&3)<<6)|d);}}return out; }
  function pngInfo(bin) { if(bin.length<24||bin.substr(0,8)!=='\x89PNG\r\n\x1a\n'||bin.substr(12,4)!=='IHDR'){fail('دارایی PNG معتبر نیست.');}function u32(i){return bin.charCodeAt(i)*16777216+bin.charCodeAt(i+1)*65536+bin.charCodeAt(i+2)*256+bin.charCodeAt(i+3);}var w=u32(16),h=u32(20);if(!w||!h||w*h>40000000||w>20000||h>20000){fail('ابعاد پیکسلی PNG بیش از حد است.');}return {width:w,height:h}; }
  function regionPoints(r) { var x=num(r.xMm,'x ناحیه'),y=num(r.yMm,'y ناحیه'),w=positive(r.widthMm,'عرض ناحیه'),h=positive(r.heightMm,'ارتفاع ناحیه');return [[x,y],[x+w,y],[x+w,y+h],[x,y+h]]; }
  function validate(m) {
    var sw,sh,i,j,k,s,l,p,pts,n=0,a,x,y,area;
    if(!m||Number(m.version)!==1||!m.sheet){fail('manifest نسخه ۱ لازم است.');}
    sw=positive(m.sheet.widthMm,'عرض شیت');sh=positive(m.sheet.heightMm,'ارتفاع شیت');if(sw>MAX_MM||sh>MAX_MM){fail('سقف شیت Illustrator برابر ۵۷۷۹mm است.');}
    if(!array(m.sections)||!m.sections.length||m.sections.length>500){fail('تعداد قطعات نامعتبر است.');}
    for(i=0;i<m.sections.length;i++){
      s=m.sections[i];positive(s.widthMm,'عرض قطعه');positive(s.heightMm,'ارتفاع قطعه');x=num(s.xMm,'x قطعه');y=num(s.yMm,'y قطعه');
      if(x<0||y<0||x+Number(s.widthMm)>sw+0.001||y+Number(s.heightMm)>sh+0.001){fail('قطعه بیرون از شیت است.');}
      pts=s.points;if(!array(pts)||pts.length<3||pts.length>512){fail('نقاط ماسک قطعه ناقص است.');}area=0;
      for(k=0;k<pts.length;k++){a=pts[k];if(!array(a)||a.length!==2){fail('نقطه ماسک نامعتبر است.');}x=num(a[0],'x نقطه');y=num(a[1],'y نقطه');if(x<0||y<0||x>Number(s.widthMm)+0.001||y>Number(s.heightMm)+0.001){fail('نقطه بیرون قطعه است.');}a=pts[(k+1)%pts.length];area+=x*num(a[1],'y نقطه')-y*num(a[0],'x نقطه');}
      if(Math.abs(area)<0.000001){fail('ماسک قطعه مساحت ندارد.');}
      if(!array(s.layers)||s.layers.length>100){fail('لایه‌های قطعه نامعتبر است.');}
      for(j=0;j<s.layers.length;j++){
        l=s.layers[j];if(!l.region){fail('ناحیهٔ لایه وجود ندارد.');}regionPoints(l.region);if(Math.abs(Number(l.region.xMm))>50000||Math.abs(Number(l.region.yMm))>50000||Number(l.region.widthMm)>50000||Number(l.region.heightMm)>50000){fail('ناحیهٔ لایه بیش از حد بزرگ است.');}
        if(!array(l.placements)){fail('جایگذاری‌های لایه ناقص است.');}
        for(k=0;k<l.placements.length;k++){p=l.placements[k];code(p.code);x=num(p.xMm,'x نقش');y=num(p.yMm,'y نقش');if(Math.abs(x)>50000||Math.abs(y)>50000||positive(p.widthMm,'عرض نقش')>MAX_MM||positive(p.heightMm,'ارتفاع نقش')>MAX_MM){fail('جایگذاری بیش از محدودهٔ Illustrator است.');}if(p.rotation!==undefined){num(p.rotation,'چرخش');}if(p.opacity!==undefined&&(num(p.opacity,'شفافیت')<0||Number(p.opacity)>1)){fail('شفافیت باید صفر تا یک باشد.');}n++;if(n>MAX_COUNT){fail('سقف ۱۰۰۰۰ جایگذاری است.');}}
      }
    }
    if(m.placementCount!==undefined&&num(m.placementCount,'تعداد جایگذاری')!==n){fail('تعداد جایگذاری با manifest برابر نیست.');}return n;
  }
  function localFile(rel,root) { if(typeof rel!=='string'||rel.indexOf('..')!==-1||!/^assets\/motifs\/[A-Za-z0-9._-]+\.png$/i.test(rel)){fail('مسیر محلی فقط assets/motifs/*.png مجاز است.');}var folder=new Folder(root),base,f;if(!folder.exists){fail('پوشهٔ کتابخانه پیدا نشد.');}base=folder.fsName.replace(/\\/g,'/').replace(/\/$/,'');f=new File(base+'/'+rel);if(!f.exists||f.fsName.replace(/\\/g,'/').indexOf(base+'/')!==0){fail('فایل نقش در کتابخانه پیدا نشد.');}return f; }
  function filePng(f) { f.encoding='BINARY';if(!f.open('r')){fail('خواندن PNG ممکن نیست.');}var h=f.read(24);f.close();if(f.length>MAX_ASSET){fail('PNG بیش از ۲۰MB است.');}pngInfo(h); }
  function prepare(m,assets,root,isExchange,ctx) {
    var i,j,k,p,c,src,bin,f,seen={};
    for(i=0;i<m.sections.length;i++){for(j=0;j<m.sections[i].layers.length;j++){for(k=0;k<m.sections[i].layers[j].placements.length;k++){
      p=m.sections[i].layers[j].placements[k];c=code(p.code);if(own(seen,c)){continue;}seen[c]=true;src=own(assets,c)?assets[c]:(own(assets,p.asset)?assets[p.asset]:(isExchange?null:p.asset));
      if(isExchange){if(typeof src!=='string'||!/^data:image\/png;base64,/i.test(src)){fail('تبادل Illustrator فقط PNG جاسازی‌شده را می‌پذیرد: '+c);}bin=decodeBase64(src.replace(/^data:image\/png;base64,/i,''));pngInfo(bin);if(bin.length>MAX_ASSET){fail('PNG بیش از ۲۰MB است.');}ctx.total+=bin.length;if(ctx.total>MAX_TOTAL){fail('جمع تصاویر بیش از ۶۴MB است.');}
        if(!ctx.folder){ctx.folder=new Folder(Folder.temp.fsName+'/naqsh_'+new Date().getTime()+'_'+Math.floor(Math.random()*1000000000));if(!ctx.folder.create()){fail('ساخت پوشه موقت ممکن نیست.');}}
        f=new File(ctx.folder.fsName+'/'+c+'.png');ctx.temporary.push(f);f.encoding='BINARY';if(!f.open('w')){fail('نوشتن PNG موقت ممکن نیست.');}f.write(bin);f.close();
      }else{f=localFile(src,root);filePng(f);ctx.total+=f.length;if(ctx.total>MAX_TOTAL){fail('جمع تصاویر بیش از ۶۴MB است.');}}
      ctx.files[c]=f;
    }}}
  }
  function cleanup(ctx) { var i;for(i=0;i<ctx.temporary.length;i++){try{ctx.temporary[i].remove();}catch(ignore){}}if(ctx.folder){try{ctx.folder.remove();}catch(ignore2){}} }
  function mask(group,points,s,name) { var path=group.pathItems.add(),out=[],i,x;for(i=0;i<points.length;i++){x=Number(points[i][0]);if(s.mirror){x=Number(s.widthMm)-x;}out.push([pt(Number(s.xMm)+x),topY(Number(s.yMm)+Number(points[i][1]))]);}path.setEntirePath(out);path.closed=true;path.filled=false;path.stroked=false;path.name=name;path.clipping=true;path.zOrder(ZOrderMethod.BRINGTOFRONT);group.clipped=true; }
  function placement(group,p,s,file) { var item=group.placedItems.add(),x=Number(p.xMm),y=Number(p.yMm),rot=Number(p.rotation||0),mx=!!p.mirrorX,my=!!p.mirrorY;if(s.mirror){x=Number(s.widthMm)-x-Number(p.widthMm);mx=!mx;rot=-rot;}item.file=file;item.width=pt(p.widthMm);item.height=pt(p.heightMm);item.position=[pt(Number(s.xMm)+x),topY(Number(s.yMm)+y)];if(mx||my){item.transform(app.getScaleMatrix(mx?-100:100,my?-100:100),true,true,true,true,100,Transformation.CENTER);}if(rot){item.rotate(-rot,true,true,true,true,Transformation.CENTER);}item.opacity=p.opacity===undefined?100:Number(p.opacity)*100;item.embed(); }
  function draw(m,ctx) { var doc=app.documents.add(DocumentColorSpace.RGB,pt(m.sheet.widthMm),pt(m.sheet.heightMm)),i,j,k,s,l,sg,lg;try{doc.artboards[0].artboardRect=[0,0,pt(m.sheet.widthMm),-pt(m.sheet.heightMm)];for(i=0;i<m.sections.length;i++){s=m.sections[i];sg=doc.groupItems.add();sg.name=String(s.name||s.id||'قطعه');for(j=0;j<s.layers.length;j++){l=s.layers[j];lg=sg.groupItems.add();lg.name=String(l.name||l.id||'لایه');for(k=0;k<l.placements.length;k++){placement(lg,l.placements[k],s,ctx.files[l.placements[k].code]);}mask(lg,regionPoints(l.region),s,'ماسک ناحیه');}mask(sg,s.points,s,'ماسک قطعه');}return doc;}catch(e){try{doc.close(SaveOptions.DONOTSAVECHANGES);}catch(ignore){}throw e;} }
  function run(m,assets,root,isExchange) { var count=validate(m),ctx={files:{},temporary:[],folder:null,total:0};try{prepare(m,assets||{},root,isExchange,ctx);draw(m,ctx);return 'OK: سند جدید با '+count+' جایگذاری، تصویر embed و ماسک بومی ساخته شد.';}finally{cleanup(ctx);} }
  function importExchange(ex) { if(!ex||ex.format!=='naqsh-project'||Number(ex.version)!==1||!ex.manifest){fail('JSON تبادل خودبسندهٔ نسخه ۱ لازم است؛ JSON تنظیمات کافی نیست.');}return run(ex.manifest,ex.assets||{},'',true); }
  function readText(f) { if(f.length>MAX_TEXT){fail('فایل بیش از ۸۰MB است.');}f.encoding='UTF-8';if(!f.open('r')){fail('خواندن فایل ممکن نیست.');}var text=f.read();f.close();return text; }
  function readLibrary(root) { var f=new File(new Folder(root).fsName+'/assets/library.json');if(!f.exists){fail('assets/library.json در پوشهٔ انتخاب‌شده پیدا نشد.');}return parse(readText(f)); }
  function importDirect(o) { if(!o||o.format!=='naqsh-direct'||Number(o.version)!==1||!o.libraryRoot||!o.project){fail('اطلاعات حالت مستقیم ناقص است.');}if(!g.NaqshEngine){fail('موتور مشترک lib/engine.js بارگذاری نشده است.');}var lib=readLibrary(o.libraryRoot),m=g.NaqshEngine.layout(o.project,lib);return run(m,{},o.libraryRoot,false); }
  function result(fn) { try{return fn();}catch(e){return 'ERROR: '+e.message;} }
  g.Naqsh_import=function(text){return result(function(){return importExchange(parse(text));});};
  g.Naqsh_importDirect=function(text){return result(function(){return importDirect(parse(text));});};
  g.Naqsh_openExchange=function(){return result(function(){var f=File.openDialog('انتخاب JSON تبادل خودبسنده','JSON:*.json');if(!f){return 'لغو شد.';}return importExchange(parse(readText(f)));});};
  g.Naqsh_chooseLibraryRoot=function(){var f=Folder.selectDialog('پوشهٔ اصلی نقش‌یار که assets/library.json دارد');return f?f.fsName:'';};
  g.Naqsh_runStandalone=function(){alert(g.Naqsh_openExchange());};
  g.NaqshTest={parse:parse,stringify:stringify,decodeBase64:decodeBase64,pngInfo:pngInfo,regionPoints:regionPoints,validateNumbers:validate,topY:topY,importObject:importExchange};
}(this));

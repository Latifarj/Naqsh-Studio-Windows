# افزونه Illustrator نقش استودیو

این پوشه منبع پنل CEP، اسکریپت مستقل و importer مستقیم است. هر دو فقط **سند جدید** Illustrator می‌سازند و سند باز موجود را ویرایش یا حذف نمی‌کنند. واحد داخلی میلی‌متر است؛ artboard صریحاً `[0, 0, widthPt, -heightPt]` تنظیم می‌شود و محور y با `top = -yMm * 72 / 25.4` به Illustrator تبدیل می‌شود.

## مسیرهای ورود

- برای پنل CEP، `host/index.jsx` فقط `lib/engine.js` و توابع `Naqsh.jsx` را load می‌کند و dialog را خودکار باز نمی‌کند. پنل می‌تواند exchange JSON وب را با `Naqsh_import` یا عملیات مستقیم کد/ابعاد را با `Naqsh_importDirect` اجرا کند.
- برای اجرای واقعی از **File > Scripts > Other Script...** فایل `standalone.jsx` را انتخاب کنید؛ این entry dialog انتخاب exchange را باز می‌کند. `Naqsh.jsx` خودِ کتابخانهٔ host است.
- exchange خودبسندهٔ نسخهٔ ۱ و ۲ را می‌پذیرد؛ دارایی‌های Illustrator همچنان باید `data:image/png;base64,...` باشند. decoder واقعی base64 به بایت است (encoder نیست) و فایل موقت را فقط بعد از `embed()` حذف می‌کند.
- direct local فقط با `libraryRoot` صریح و مسیر نسبی `assets/motifs/*.png` مجاز است و `assets/library.json` را از همان root می‌خواند. URI خارجی، `file://`، `..` و هر فایل بیرون root رد می‌شود. JPG/JPEG و SVG در native importer پشتیبانی نمی‌شوند؛ پیام محدودیت شفاف نمایش داده می‌شود.

## ایمنی و هندسه

قبل از ایجاد document، format/version، همهٔ عددها، نقاط، regionها، placementها، count و اندازهٔ شیت بررسی می‌شوند؛ سقف شیت ۵۷۷۹ میلی‌متر و placement برابر ۱۰۰۰۰ است. manifest تولیدشده از shared engine مستقیماً مصرف می‌شود: quantity دوباره تکرار نمی‌شود، `manifest.points` شکل واقعی section است و `layer.region` ناحیهٔ clipping است. چرخش ۹۰ درجهٔ قطعه به‌صورت گروه بومی اعمال می‌شود. clipping pathهای native برای section و region ساخته می‌شوند. placementهای native پس از embed دوباره استفاده نمی‌شوند. در خطا سند تازهٔ نیمه‌ساخته بدون ذخیره بسته می‌شود؛ سند قبلی دست‌نخورده می‌ماند.

`lib/engine.js` نسخهٔ بسته‌بندی‌شدهٔ `shared/engine.js` است؛ تست اصلی تفاوت بایت‌به‌بایت دو فایل را رد می‌کند تا drift ناخواسته آشکار شود.

## نصب توسعه‌ای Windows / macOS

1. کل پوشهٔ `illustrator` را در مسیر CEP کاربر با شناسهٔ افزونه کپی کنید؛ مسیر رایج Windows: `%APPDATA%\\Adobe\\CEP\\extensions\\com.naqsh.studio` و macOS: `~/Library/Application Support/Adobe/CEP/extensions/com.naqsh.studio`.
2. برای افزونهٔ unsigned، PlayerDebugMode را برای نسخهٔ CSXS نصب‌شده طبق راهنمای Adobe فعال کنید؛ کلید و نسخه بسته به Creative Cloud ممکن است متفاوت باشد.
3. Illustrator را کاملاً ببندید و باز کنید، سپس Window > Extensions (Legacy) > نقش استودیو را اجرا کنید.
4. این بسته signed ZXP نیست و ادعای امضای دیجیتال یا نصب production ندارد. برای حذف، Illustrator را ببندید و پوشهٔ افزونه را پاک کنید.

## آزمون و محدودیت اثبات

اجرا از ریشهٔ پروژه:

```bash
node illustrator/tests/test.js
node --check illustrator/client/app.js
node --check illustrator/lib/engine.js
```

این تست‌ها parser، decoder بایت PNG، اعتبارسنجی قبل از ساخت سند، ماسک و مختصات، قرینهٔ قطعه، ورود نسخهٔ ۲ و چرخش گروه را با مدل API بررسی می‌کنند. Illustrator در این محیط در دسترس نیست؛ بنابراین هیچ ادعای اجرای واقعی `app.documents`, native clipping یا `embed()` داخل Illustrator مطرح نمی‌شود. SVG سفارشی و rasterهای JPG/JPEG در این importer عمداً رد می‌شوند، نه اینکه موفقیت جعلی گزارش شود.

## منابع

- راهنمای رسمی Adobe CEP: https://github.com/Adobe-CEP/Getting-Started-guides
- مستندات Illustrator GroupItem: https://ai-scripting.docsforadobe.dev/jsobjref/GroupItem/
- مستندات Illustrator PlacedItem: https://ai-scripting.docsforadobe.dev/jsobjref/PlacedItem/

OpenRecall 1.0.1 for Windows
============================

No Node.js or pnpm installation is required.

Normal mode
-----------
Double-click OpenRecall.cmd. Your database, logs, and backups stay in:
%LOCALAPPDATA%\OpenRecall-nodejs\Data

Portable mode
-------------
Double-click OpenRecall-Portable.cmd. Your database, logs, and backups stay in
the Data folder beside the launcher. Keep the whole folder in a writable
location and move the whole folder together. Portable and normal data do not
migrate or merge automatically.

OpenRecall listens only on http://127.0.0.1:3210. It waits for the local server
to become healthy, then opens the Windows default browser. Close the launcher
window or press Ctrl+C to stop the local server. Use OpenRecall's backup page before
moving, replacing, or deleting any data folder.

العربية
=======

لا تحتاج إلى تثبيت Node.js أو pnpm.

شغّل OpenRecall.cmd للوضع العادي؛ تحفظ البيانات في:
%LOCALAPPDATA%\OpenRecall-nodejs\Data

شغّل OpenRecall-Portable.cmd للوضع المحمول؛ تحفظ البيانات في مجلد Data بجوار
المشغّل. ضع المجلد كاملًا في مكان قابل للكتابة وانقله كاملًا. لا تُدمج بيانات
الوضعين تلقائيًا. أوقف الخادم بإغلاق نافذة المشغّل أو Ctrl+C، وأنشئ نسخة
احتياطية من داخل OpenRecall قبل نقل مجلد البيانات أو استبداله أو حذفه.

// 75 Hard service worker: always fetch fresh files (so updates show up fast); handles reminders later.
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{});
self.addEventListener('push',e=>{
  let d={title:'75 Hard',body:'Time to drink some water.'};
  try{d=Object.assign(d,e.data.json())}catch(_){}
  e.waitUntil(self.registration.showNotification(d.title,{body:d.body,icon:'icon-180.png',badge:'icon-180.png',data:{url:d.url||'./'}}));
});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{const u=(e.notification.data&&e.notification.data.url)||'./';for(const c of l){if('focus' in c){c.postMessage({celebrate:u.includes('celebrate')});return c.focus()}}return clients.openWindow(u)}))});

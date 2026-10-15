// Exercise the actual provider with Shell/clock/file boundaries substituted.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../gnome-46/lib/providers/screenTime.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export class ScreenTimeProvider', 'class ScreenTimeProvider') + '\nthis.Provider = ScreenTimeProvider;';
const activity = await import('data:text/javascript;base64,' + Buffer.from(readFileSync(new URL('../gnome-46/lib/activity.js', import.meta.url))).toString('base64'));
let wall = new Date(2026,9,14,12).getTime(), mono = 0, idle = 0, persisted = 0;
let focus, mode;
class Clock extends Date { constructor(...a) { super(...(a.length ? a : [wall])); } static now() { return wall; } }
const context = {
    Date: Clock, TextDecoder, TextEncoder, JSON, Math, Set, Object, Array,
    ...activity,
    GLib: {get_user_data_dir:()=>'/unused',build_filenamev:a=>a.join('/'),get_monotonic_time:()=>mono,
        file_get_contents:()=>{throw Error('No existing history');},timeout_add_seconds:()=>1,
        source_remove:()=>{},mkdir_with_parents:()=>{}},
    Gio: {DesktopAppInfo:{new:()=>({get_name:()=> 'Editor',get_icon:()=>null})},File:{new_for_path:()=>({get_parent:()=>({get_path:()=>'/unused'}),replace_contents:()=>persisted++})},
        FileCreateFlags:{PRIVATE:1,REPLACE_DESTINATION:2}},
    Shell: {WindowTracker:{get_default:()=>({get_window_app:()=>({get_id:()=> 'editor.desktop'})})}},
    Main: {sessionMode:{isLocked:false,isGreeter:false,connect:(_name,fn)=>{mode=fn;return 1;},disconnect:()=>{}}},
    global:{backend:{get_core_idle_monitor:()=>({get_idletime:()=>idle})},display:{focus_window:{},
        connect:(_name,fn)=>{focus=fn;return 1;},disconnect:()=>{}}},
    logError:()=>{},
};
vm.createContext(context); vm.runInContext(source,context);
const provider = new context.Provider();
const tick = seconds => {wall+=seconds*1000;mono+=seconds*1e6;provider._tick();};
tick(5); assert.equal(provider.getTotalSeconds(),5);
assert.equal(provider.getTopApps()[0].seconds,5);
idle=300001;tick(5);assert.equal(provider.getTotalSeconds(),5);
idle=0;tick(5);tick(5);assert.equal(provider.getTotalSeconds(),10);
context.Main.sessionMode.isLocked=true;mode();tick(5);assert.equal(provider.getTotalSeconds(),10);
context.Main.sessionMode.isLocked=false;mode();tick(5);assert.equal(provider.getTotalSeconds(),15);
tick(3600);assert.equal(provider.getTotalSeconds(),15);
assert.equal(provider.getTotalSeconds(-1),0);
assert.equal(provider.getTopApps(4,-1).length,0);
focus();provider.destroy();assert.ok(persisted>0);
console.log('Actual ScreenTimeProvider: idle, lock, resume-gap, persistence and missing history passed.');

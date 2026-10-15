// Exercise distributed provider code without Shell, network, settings or secrets.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url));
for(let version=45;version<=51;version++) {
    const root=path.join(base,`gnome-${version}`);
    const calls=[],timers=[];
    const GLib={PRIORITY_LOW:0,SOURCE_CONTINUE:true,SOURCE_REMOVE:false,
        timeout_add_seconds:(_priority,_seconds,fn)=>{timers.push(fn);return timers.length;},
        source_remove(){},build_filenamev:parts=>parts.join('/')};
    const cf=readFileSync(path.join(root,'lib/providers/codeforces.js'),'utf8')
        .replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+'\nthis.Provider=CodeforcesProvider;';
    const scope={GLib,Soup:{Session:class{}},Set,Map,Date,JSON,encodeURIComponent};
    vm.createContext(scope);vm.runInContext(cf,scope);
    scope.Provider.prototype._fetch=function(key,endpoint){calls.push({key,endpoint});};
    new scope.Provider();
    for(const fn of timers.slice(1)) fn();
    assert.deepEqual(calls.map(call=>call.key),['contests']);
    assert.ok(calls.every(call=>!call.endpoint.includes('handles=')&&!call.endpoint.includes('handle=')));
    const bridge=readFileSync(path.join(root,'lib/providers/accountBridge.js'),'utf8')
        .replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+'\nthis.Bridge=AccountBridge;';
    const secrets={Gio:{Subprocess:{new(){throw Error('Unexpected account subprocess');}}},GLib,Set};
    vm.createContext(secrets);vm.runInContext(bridge,secrets);
    const provider=new secrets.Bridge('/unused','leetcode-fetch','');
    assert.equal(provider.error,'Configure LeetCode username');
    assert.equal(provider.data,null);
}
console.log('All seven versions start without querying any default personal account.');

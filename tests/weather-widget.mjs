import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
class Actor {
    constructor(props = {}) { Object.assign(this, {width: 1, height: 1, children: []}, props); }
    add_child(child) { this.children.push(child); }
    destroy_all_children() { this.children=[]; }
    set_position(x,y) { this.x=x;this.y=y; }
    set_pivot_point() {}
}
class Label extends Actor { constructor(props) { super(props); this.clutter_text={}; } }
const source=readFileSync(new URL('../gnome-46/widgets/weather.js',import.meta.url),'utf8')
    .replace(/^import .*;\n/gm,'').replace('export class WeatherWidget','class WeatherWidget')+'\nthis.Widget=WeatherWidget;';
const context={Clutter:{Actor,ActorAlign:{CENTER:0,END:1}},St:{Label,BoxLayout:Actor,Widget:Actor,Icon:Actor},
    Gio:{icon_new_for_string:s=>s},GLib:{build_filenamev:a=>a.join('/')},Pango:{EllipsizeMode:{END:1},Alignment:{RIGHT:1}},
    FONT:{},fontStyle:()=>'',wmoCondition:()=> 'Heavy Thunderstorm',wmoIconName:()=> 'sunny',skyGradient:()=>({dark:false}),};
vm.createContext(context);vm.runInContext(source,context);
const data={name:'A very long city and region name',temp:32,hi:35,lo:24,precipProb:30,wind:10,windUnit:'km/h',windDir:'NE',code:0,isDay:true,
    hours:[],days:[]};
for(const [mode,w,h] of [['small',170,170],['big',348,170],['full',348,348]]){
    const root=new Actor();
    const widget=new context.Widget(root,{path:'/unused',weather:{subscribe:fn=>{fn(data,null);return ()=>{};}}},{w,h},mode);
    const temp=widget._root.children.find(child=>child.text==='32°');
    assert.ok(temp,`${mode} must display the temperature`);
    assert.ok(temp.width>80,`${mode} must not use the label's unallocated width of one pixel`);
    const name=widget._root.children.find(child=>child.text===data.name);
    assert.ok(name.width>40&&name.width<w,'city has its own explicit bounded width');
}
console.log('Weather temperature and city width regression: all three variants passed.');

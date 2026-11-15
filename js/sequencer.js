import * as THREE from 'three';
import { createMotionClip } from './motion-library.js';

export class AnimationSequencer {
  constructor(root, mixer, onStatus=()=>{}) {
    this.root=root; this.mixer=mixer; this.onStatus=onStatus;
    this.plan=[]; this.index=0; this.current=null; this.listener=null; this.stopped=true;
  }
  stop() {
    this.stopped=true;
    if (this.listener) this.mixer.removeEventListener('finished',this.listener);
    this.listener=null;
    this.mixer.stopAllAction();
    this.current=null;
  }
  play(plan) {
    this.stop();
    this.plan=plan.actions.flatMap(a=>Array.from({length:a.repeat||1},()=>({...a})));
    this.index=0; this.stopped=false; this.playNext();
  }
  playNext() {
    if (this.stopped) return;
    if (this.index>=this.plan.length) { this.onStatus('Hoàn tất chuỗi hành động'); this.stopped=true; return; }
    const item=this.plan[this.index++];
    this.root.updateMatrixWorld(true);
    let clip;
    try { clip=createMotionClip(this.root,item.action,item.duration,item.intensity||1); }
    catch(error) { this.onStatus(error.message,'error'); this.stopped=true; return; }
    const next=this.mixer.clipAction(clip);
    next.reset(); next.setLoop(THREE.LoopOnce,1); next.clampWhenFinished=true;
    if (this.current) next.crossFadeFrom(this.current,0.22,false);
    next.play(); this.current=next;
    this.onStatus('Đang chạy: '+item.action+' ('+this.index+'/'+this.plan.length+')');
    this.listener=event=>{
      if(event.action!==next)return;
      this.mixer.removeEventListener('finished',this.listener); this.listener=null;
      this.playNext();
    };
    this.mixer.addEventListener('finished',this.listener);
  }
}

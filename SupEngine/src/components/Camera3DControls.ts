import * as THREE from "three";
import ActorComponent from "../ActorComponent";
import Actor from "../Actor";
import Camera from "./Camera";

const tmpMovement = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const forwardVector = new THREE.Vector3(0, 1, 0);

if (typeof window === "object") {
  var hkm = (<any>window).SupCore.hotKeyMgr;
  console.log('Camera3DControls: this; ' + this);
}


export default class Camera3DControls extends ActorComponent {
  camera: Camera;
  rotation: THREE.Euler;
  movementSpeed = 0.2;

  hotKeys = {
    groupName: "Camera3DControls",
    actions: {
      SET_X_NEG: { meta:  "DOM_VK_NULL", core:  "DOM_VK_A"},
      SET_X_POS: { meta:  "DOM_VK_NULL", core:  "DOM_VK_Z"},
      SET_Y_NEG: { meta:  "DOM_VK_SHIFT", core:  "DOM_VK_Y"},
      SET_Y_POS: { meta:  "DOM_VK_NULL", core:  "DOM_VK_Y"},
      SET_Z_NEG: { meta:  "DOM_VK_NULL", core:  "DOM_VK_W"},
      SET_Z_POS: { meta:  "DOM_VK_NULL", core:  "DOM_VK_S"},
      MOUSE_ROT: { meta:  "DOM_VK_ALT", core:  "DOM_VK_NULL"}
    }

  };

  constructor(actor: Actor, camera: Camera) {
    super(actor, "Camera3DControls");

    this.camera = camera;
    this.rotation = actor.getLocalEulerAngles(new THREE.Euler());

    this.defHotKeys();

  }
  defHotKeys () {
    if (typeof window !== "object") {
      return;
    }

    let result = { ok: false, keySet: {}, msg: ""};
    let groupName = this.hotKeys.groupName;

    result = hkm.decGroup(groupName);
    if(!result.ok) {
      console.log(groupName + ": " + result.msg);
    }

    let castActions:any = this.hotKeys.actions;
    for(let action in castActions) {
      if (castActions.hasOwnProperty(action)) {
        result=hkm.decAction(groupName, action);
        if(result.ok) {

            let metaStr = castActions[action].meta;
            let coreStr = castActions[action].core;
            castActions[action] = result.keySet;

            result = hkm.setAction(groupName, action, metaStr, coreStr);
            if(!result.ok) {
              console.error(groupName + ": " + result.msg);
              return;
            }

        } else {
            result = hkm.getKeySet(groupName, action);

            if(!result.ok) {
              console.error(groupName + ": " + result.msg);
              return;
            }
            castActions[action] = result.keySet;

        }

      }

    }
    hkm.loadConfig(groupName);
  }

  setIsLayerActive(active: boolean) { /* Nothing to render */ }

  update() {

    const keyButtons = this.actor.gameInstance.input.keyboardButtons;
    const actions = this.hotKeys.actions;

    if (hkm.inKeyboardButtonArray(actions.SET_X_POS, keyButtons)) {
      tmpMovement.setX(this.movementSpeed);
    } else {
      if (hkm.inKeyboardButtonArray(actions.SET_X_NEG, keyButtons)) {
        tmpMovement.setX(-this.movementSpeed);
      } else {
        tmpMovement.setX(0);
      }
    }
    if (hkm.inKeyboardButtonArray(actions.SET_Y_POS, keyButtons)) {
      tmpMovement.setY(this.movementSpeed);
    } else {
      if (hkm.inKeyboardButtonArray(actions.SET_Y_NEG, keyButtons)) {
        tmpMovement.setY(-this.movementSpeed);
      } else {
        tmpMovement.setY(0);
      }
    }
    if (hkm.inKeyboardButtonArray(actions.SET_Z_POS, keyButtons)) {
      tmpMovement.setZ(this.movementSpeed);
    } else {
      if (hkm.inKeyboardButtonArray(actions.SET_Z_NEG, keyButtons)) {
        tmpMovement.setZ(-this.movementSpeed);
      } else {
        tmpMovement.setZ(0);
      }
    }
    tmpMovement.applyQuaternion(tmpQuaternion.setFromAxisAngle(forwardVector, this.rotation.y));
    this.actor.moveLocal(tmpMovement);

    // Camera rotation
    if (this.actor.gameInstance.input.mouseButtons[1].isDown ||
    (this.actor.gameInstance.input.mouseButtons[0].isDown && hkm.inKeyboardButtonArray(actions.MOUSE_ROT, keyButtons))) {
      this.rotation.x = Math.min(Math.max(this.rotation.x - this.actor.gameInstance.input.mouseDelta.y / 250, -Math.PI / 2), Math.PI / 2);
      this.rotation.y -= this.actor.gameInstance.input.mouseDelta.x / 250;
      this.actor.setLocalEulerAngles(this.rotation);
    }

  }
}

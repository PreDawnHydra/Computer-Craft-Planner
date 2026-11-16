import './style.css';
import { ComputerHandle } from './computer/ComputerHandle.js';
import { ComputerScreen } from './ui/ComputerScreen.js';
import { applyMinecraftTheme } from './ui/mcTheme.js';

applyMinecraftTheme();

const handle = new ComputerHandle({ id: 0, autoOn: true });
const screen = new ComputerScreen(handle, { family: 'advanced' });
const stage = document.getElementById('stage');
stage.append(screen.el);

const fit = () => screen.fit(stage.clientWidth - 32, stage.clientHeight - 32);
window.addEventListener('resize', fit);
fit();
screen.focus();

const title = document.getElementById('title');
const status = document.getElementById('status');
handle.on('state', (st) => {
  title.textContent = st.label ? `${st.label} (#${st.id})` : `Computer #${st.id}`;
  status.textContent = st.on ? 'On' : 'Off';
  status.classList.toggle('on', st.on);
});

document.getElementById('btn-power').onclick = () => { handle.state.on ? handle.shutdown() : handle.turnOn(); screen.focus(); };
document.getElementById('btn-reboot').onclick = () => { handle.reboot(); screen.focus(); };
document.getElementById('btn-terminate').onclick = () => { handle.queueEvent('terminate'); screen.focus(); };

window.cc = handle; // handy for debugging from the console

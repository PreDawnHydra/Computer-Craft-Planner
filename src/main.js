import './style.css';
import { applyMinecraftTheme } from './ui/mcTheme.js';
import { App } from './world/App.js';

applyMinecraftTheme();
const app = new App(document.getElementById('game'));
app.start();
window.app = app; // handy for debugging from the console

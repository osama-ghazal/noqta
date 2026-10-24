// App Bridge first: it creates `window.noqta` and adds the session token to fetch('/api/…').
import '@noqtaps/app-bridge'
import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

createApp(App).mount('#app')

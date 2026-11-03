/* Sincronizzazione automatica di stato lavori, note ed esiti collaudo tra dispositivi.
   Regola: per ogni alloggio vince la modifica più recente. Va caricato DOPO lo script principale. */
(function () {
    const API = '/api/dati';
    const KEY_DATI = 'valmaura_serramenti_data_light_v2';   // stessa chiave usata dalla pagina
    const KEY_HASH = 'valmaura_sync_hash';
    const KEY_INIT = 'valmaura_sync_init';

    const snap = a => {
        const c = a.collaudo || {};
        return {
            stato: a.stato || 'In produzione', note: a.note || '',
            collaudo: { data: c.data || '', tecnico: c.tecnico || '', esito: c.esito || 'Da eseguire',
                        noteVerifica: c.noteVerifica || '', fileWord: c.fileWord || '' }
        };
    };
    const sig = a => JSON.stringify(snap(a));
    const SIG_DEFAULT = sig({});
    const isDefault = a => sig(a) === SIG_DEFAULT;
    const pack = a => Object.assign({ _t: a._t || 0 }, snap(a));
    const applica = (a, r) => {
        a.stato = r.stato; a.note = r.note;
        if (!a.collaudo) a.collaudo = { foto: [] };
        Object.assign(a.collaudo, r.collaudo);    // le foto restano gestite a parte
        a._t = r._t;
    };
    const leggiHash = () => JSON.parse(localStorage.getItem(KEY_HASH) || 'null');

    const extra = {
        datiMsg: '',

        adottaElenco(elenco) {
            this.alloggi = elenco.alloggi;
            this.modaleGestioneAperto = false;
            this.filtroCivico = this.filtroDitta = this.filtroStato = this.filtroEsito = this.ricercaTesto = '';
            localStorage.setItem(KEY_DATI, JSON.stringify(this.alloggi));
            localStorage.setItem('valmaura_elenco_versione', elenco.versione);
            this.baselineDati();
            localStorage.removeItem(KEY_INIT);
        },

        async pubblicaElenco(righe) {
            let risposta;
            try {
                risposta = await fetch(API + '?elenco', {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(righe)
                });
            } catch {
                throw new Error('Caricamento non completato: verifica la connessione e riprova. L’elenco locale non è stato sostituito.');
            }
            if (!risposta.ok) throw new Error('Caricamento non completato. Verifica il file e riprova online.');
            this.adottaElenco(await risposta.json());
            this.datiMsg = '☁ Elenco aggiornato sul sito';
            this.pianificaSync();
        },

        // memorizza lo stato attuale come "già noto" (senza considerarlo una modifica)
        baselineDati() {
            const hs = {};
            this.alloggi.forEach(a => { hs[String(a.id)] = sig(a); });
            localStorage.setItem(KEY_HASH, JSON.stringify(hs));
        },

        // chiamata dopo ogni salvataggio: riconosce cosa è cambiato e lo marca con l'ora
        marcaModifiche() {
            const hs = leggiHash();
            if (!hs) { this.baselineDati(); return; }
            let cambiato = false;
            this.alloggi.forEach(a => {
                const id = String(a.id), s = sig(a);
                if (hs[id] === s) return;
                if (hs[id] !== undefined || !isDefault(a)) a._t = Date.now();
                hs[id] = s; cambiato = true;
            });
            if (cambiato) {
                localStorage.setItem(KEY_HASH, JSON.stringify(hs));
                localStorage.setItem(KEY_DATI, JSON.stringify(this.alloggi));   // salva anche _t
                this.pianificaSync();
            }
        },

        pianificaSync() {
            clearTimeout(this._tSync);
            this._tSync = setTimeout(() => this.sincronizzaDati(), 1500);
        },

        async sincronizzaDati() {
            if (this.excelOccupato) { this.pianificaSync(); return; }
            if (this._datiBusy) { this._datiRipeti = true; return; }
            this._datiBusy = true;
            try {
                const listaRes = await fetch(API + '?elenco', { cache: 'no-store' });
                if (!listaRes.ok) throw new Error('HTTP ' + listaRes.status);
                const elenco = await listaRes.json();
                if (this.excelOccupato) return;
                const tagAttivo = document.activeElement && document.activeElement.tagName;
                if (elenco && elenco.versione !== localStorage.getItem('valmaura_elenco_versione')) {
                    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tagAttivo)) return;
                    this.adottaElenco(elenco);
                }
                const res = await fetch(API, { cache: 'no-store' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const remoto = await res.json();
                if (this.excelOccupato) return;
                const primo = !localStorage.getItem(KEY_INIT);
                const remotoVuoto = Object.keys(remoto).length === 0;
                const tag = document.activeElement && document.activeElement.tagName;
                const inModifica = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);   // non sovrascrivo mentre scrivi
                const hs = leggiHash() || {};
                const invio = {};
                let applicato = false;

                for (const a of this.alloggi) {
                    const id = String(a.id), r = remoto[id];
                    const tl = a._t || 0, tr = (r && r._t) || 0;
                    if (primo) {
                        // primo avvio: se il cloud è vuoto lo riempio io, altrimenti adotto i dati del cloud
                        if (remotoVuoto) { if (!isDefault(a)) { a._t = Date.now(); invio[id] = pack(a); } }
                        else if (r && !inModifica) { applica(a, r); hs[id] = sig(a); applicato = true; }
                    } else if (r && tr > tl && !inModifica) { applica(a, r); hs[id] = sig(a); applicato = true; }
                    else if (tl > tr) { invio[id] = pack(a); }
                }
                localStorage.setItem(KEY_HASH, JSON.stringify(hs));
                if (applicato || primo) localStorage.setItem(KEY_DATI, JSON.stringify(this.alloggi));
                if (!(primo && !remotoVuoto && inModifica)) localStorage.setItem(KEY_INIT, '1');

                if (Object.keys(invio).length) {
                    const p = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invio) });
                    if (!p.ok) throw new Error('HTTP ' + p.status);
                }
                this.datiMsg = '☁ Dati sincronizzati alle ' + new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
            } catch (e) {
                this.datiMsg = '⚠ Dati non ancora sincronizzati: verranno inviati appena possibile';
            } finally {
                this._datiBusy = false;
                if (this._datiRipeti) { this._datiRipeti = false; this.pianificaSync(); }
            }
        },

        avviaSyncDati() {
            if (!leggiHash()) this.baselineDati();
            this.sincronizzaDati();
            window.addEventListener('online', () => this.sincronizzaDati());
            document.addEventListener('visibilitychange', () => { if (!document.hidden) this.sincronizzaDati(); });
            setInterval(() => { if (!document.hidden) this.sincronizzaDati(); }, 30000);
        }
    };

    // Aggancia i metodi all'app esistente
    const originale = window.valmauraApp;
    window.valmauraApp = function () {
        const o = Object.assign(originale(), extra);
        const salvaDati = o.salvaDati, init = o.init;
        o.salvaDati = function () { salvaDati.call(this); this.marcaModifiche(); };
        o.init = function () { init.call(this); this.avviaSyncDati(); };
        return o;
    };

    // Stato della sincronizzazione sotto la scritta "Salvataggio automatico"
    const box = Array.from(document.querySelectorAll('div')).find(d => d.children.length === 0 && d.textContent.includes('Salvataggio automatico attivo'));
    if (box) box.insertAdjacentHTML('beforeend',
        `<div class="mt-1 font-semibold text-slate-600"><span x-text="datiMsg"></span>
         <button @click="sincronizzaDati()" class="ml-1 underline text-slate-400">sincronizza ora</button></div>`);
})();

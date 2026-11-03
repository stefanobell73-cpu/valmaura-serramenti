/* Esportazione completa locale: dati + tutte le foto e schede presenti sul dispositivo. */
(function () {
    const KEY_ESPORTATE = 'valmaura_foto_esportate';
    const pad = (n, l = 2) => String(n).padStart(l, '0');
    const pulisci = s => String(s ?? '').replace(/[\\/:*?"<>|]/g, '-').trim() || 'ND';
    const stampa = ms => {
        const d = new Date(ms || Date.now());
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    };
    const caricaJSZip = () => window.JSZip ? Promise.resolve() : new Promise((ok, ko) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
        s.onload = ok;
        s.onerror = () => ko(new Error('Libreria ZIP non disponibile. Apri l’app almeno una volta con Internet e riprova.'));
        document.head.appendChild(s);
    });
    const extra = {
        zipInCorso: false,
        zipMsg: '',
        async esportaZip() {
            if (this.zipInCorso) return;
            this.zipInCorso = true;
            this.zipMsg = 'Preparazione del backup completo...';
            try {
                await caricaJSZip();
                const lista = this.alloggi.slice(); // SEMPRE tutte le righe, senza considerare filtri
                const chiavi = new Map(lista.map(a => [this.chiaveAlloggio(a), a]));
                const tutteFoto = await FotoDB.tutte();
                const foto = tutteFoto.filter(r => r.stato !== 'da_eliminare' && r.blob instanceof Blob); // include anche eventuali foto non più associate a una riga
                const zip = new JSZip();
                const incluse = [];
                const manifestFoto = [];
                const righe = [['Civico', 'Interno', 'Inquilino', 'Ditta', 'Fase', 'Stato lavori', 'Esito collaudo', 'Data sopralluogo', 'Note cantiere', 'Note verifica', 'Foto totali']];
                const perChiave = {};
                for (const r of foto) (perChiave[r.alloggioKey] ||= []).push(r);
                for (const a of lista) {
                    const chiave = this.chiaveAlloggio(a);
                    const cartella = `Civico ${pulisci(a.civico)}/Int. ${pad(pulisci(a.interno))}/`;
                    const records = (perChiave[chiave] || []).sort((x, y) => (x.data || 0) - (y.data || 0));
                    records.forEach((r, i) => {
                        const isScheda = String(r.uid || '').startsWith('scheda-');
                        const tipo = isScheda ? 'SCHEDA_' : '';
                        const nome = `${pulisci(a.civico)}_int${pad(pulisci(a.interno))}_${tipo}${stampa(r.data)}_${pad(i + 1)}.jpg`;
                        const percorso = cartella + nome;
                        zip.file(percorso, r.blob, { compression: 'STORE' });
                        incluse.push(r.uid || String(r.id));
                        manifestFoto.push({ id: r.id, uid: r.uid || null, alloggioKey: r.alloggioKey, nomeOriginale: r.nome || nome, data: r.data || null, size: r.size || r.blob.size, percorso, tipo: isScheda ? 'scheda' : 'foto' });
                    });
                    const c = a.collaudo || {};
                    righe.push([a.civico, a.interno, a.nominativo, a.impresa, a.fase, a.stato, c.esito || '', c.data || '', a.note || '', c.noteVerifica || '', records.length]);
                }
                // Non perdere eventuali foto rimaste nel database locale senza una riga corrispondente.
                const giaIncluse = new Set(manifestFoto.map(x => x.id));
                for (const r of foto) {
                    if (giaIncluse.has(r.id)) continue;
                    const percorso = `Foto_senza_riga/${pulisci(r.alloggioKey)}/${pulisci(r.nome || ('foto_' + r.id + '.jpg'))}`;
                    zip.file(percorso, r.blob, { compression: 'STORE' });
                    manifestFoto.push({ id: r.id, uid: r.uid || null, alloggioKey: r.alloggioKey, nomeOriginale: r.nome || percorso, data: r.data || null, size: r.size || r.blob.size, percorso, tipo: String(r.uid || '').startsWith('scheda-') ? 'scheda' : 'foto', senzaRiga: true });
                    incluse.push(r.uid || String(r.id));
                }
                const backup = {
                    formato: 'ValmauraBackupLocale', versione: 1, esportatoIl: new Date().toISOString(),
                    avvertenza: 'Backup completo dell’app. Le fotografie sono nei percorsi elencati in manifestFoto.',
                    alloggi: lista,
                    manifestFoto
                };
                zip.file('Backup_dati.json', JSON.stringify(backup, null, 2));
                zip.file('Manifest_fotografie.json', JSON.stringify(manifestFoto, null, 2));
                if (window.XLSX) {
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(righe), 'Riepilogo');
                    zip.file('Riepilogo.xlsx', XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
                }
                zip.file('LEGGIMI.txt', 'BACKUP VALMAURA\n\nQuesto archivio contiene l’elenco completo degli alloggi, gli stati, le note, i dati di collaudo e tutte le fotografie/schede presenti nella memoria locale del telefono al momento dell’esportazione.\n\nConservare questo ZIP in OneDrive. Il backup non viene caricato automaticamente: ripetere l’esportazione dopo le modifiche e le nuove fotografie.\n');
                this.zipMsg = `Creo lo ZIP: ${foto.length} fotografie e ${lista.length} righe...`;
                const blob = await zip.generateAsync({ type: 'blob' }, m => { this.zipMsg = 'Creo lo ZIP... ' + Math.round(m.percent) + '%'; });
                const nome = `Valmaura_backup_completo_${stampa(Date.now()).slice(0, 10)}.zip`;
                const file = new File([blob], nome, { type: 'application/zip' });
                let fatto = false;
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    try { await navigator.share({ files: [file], title: nome }); fatto = true; }
                    catch (e) { if (e.name === 'AbortError') { this.zipMsg = 'Condivisione annullata: il backup non è stato esportato.'; return; } }
                }
                if (!fatto) {
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a'); link.href = url; link.download = nome;
                    document.body.appendChild(link); link.click(); link.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 60000);
                }
                localStorage.setItem(KEY_ESPORTATE, JSON.stringify(incluse));
                this.zipMsg = `✓ Backup completo pronto: ${lista.length} righe e ${foto.length} fotografie. Salvalo in OneDrive.`;
            } catch (e) {
                this.zipMsg = 'Errore durante il backup: ' + (e && e.message ? e.message : e);
            } finally { this.zipInCorso = false; }
        },
        async importaZip(event) {
            const file = event.target.files && event.target.files[0];
            event.target.value = '';
            if (!file) return;
            if (!confirm('Ripristinare questo backup? I dati e le fotografie attualmente presenti su questo telefono verranno sostituiti.')) return;
            this.zipInCorso = true;
            this.zipMsg = 'Lettura del backup...';
            try {
                await caricaJSZip();
                const zip = await JSZip.loadAsync(file);
                const entry = zip.file('Backup_dati.json');
                let nuoveRighe, records = [];
                if (entry) {
                    // Formato ZIP completo generato da questa versione locale.
                    const backup = JSON.parse(await entry.async('string'));
                    if (backup.formato !== 'ValmauraBackupLocale' || !Array.isArray(backup.alloggi) || !Array.isArray(backup.manifestFoto)) {
                        throw new Error('Formato del backup non riconosciuto.');
                    }
                    nuoveRighe = backup.alloggi;
                    for (let i = 0; i < backup.manifestFoto.length; i++) {
                        const meta = backup.manifestFoto[i];
                        const item = zip.file(meta.percorso);
                        if (!item) throw new Error('Nel backup manca una fotografia: ' + meta.percorso);
                        const blob = await item.async('blob');
                        records.push({ uid: meta.uid || ('import-' + Date.now() + '-' + i), alloggioKey: meta.alloggioKey, blob, nome: meta.nomeOriginale || meta.percorso.split('/').pop(), size: blob.size, data: meta.data || Date.now(), stato: 'locale' });
                    }
                } else {
                    // Compatibilità con il vecchio ZIP Netlify: prima importare il JSON con il pulsante Importa Backup.
                    if (!Array.isArray(this.alloggi) || !this.alloggi.length) {
                        throw new Error('Vecchio ZIP foto: prima importa il file JSON con il pulsante Importa Backup, poi seleziona nuovamente questo ZIP.');
                    }
                    nuoveRighe = JSON.parse(JSON.stringify(this.alloggi));
                    const fotoFiles = Object.values(zip.files).filter(f => !f.dir && /^Civico [^/]+\/Int\. [^/]+\/.+\.(jpg|jpeg|png|webp)$/i.test(f.name));
                    if (!fotoFiles.length) throw new Error('Non trovo fotografie nello ZIP selezionato.');
                    const perAlloggio = {};
                    for (let i = 0; i < fotoFiles.length; i++) {
                        const f = fotoFiles[i];
                        const m = f.name.match(/^Civico ([^/]+)\/Int\. ([^/]+)\/(.+)$/i);
                        if (!m) continue;
                        const civico = m[1].trim();
                        const interno = m[2].trim().replace(/^0+(?=\d)/, '');
                        const alloggio = nuoveRighe.find(a => String(a.civico).trim() === civico && String(a.interno).trim().replace(/^0+(?=\d)/, '') === interno);
                        if (!alloggio) continue;
                        const alloggioKey = String(alloggio.civico) + '-' + String(alloggio.interno);
                        const blob = await f.async('blob');
                        const isScheda = /SCHEDA_/i.test(m[3]);
                        const uid = (isScheda ? 'scheda-' : 'import-') + Date.now().toString(36) + '-' + i;
                        records.push({ uid, alloggioKey, blob, nome: m[3], size: blob.size, data: Date.now() + i, stato: 'locale' });
                        (perAlloggio[alloggioKey] ||= []).push(uid);
                    }
                    if (!records.length) throw new Error('Le fotografie non corrispondono alle righe del backup JSON. Verifica di aver selezionato il JSON corretto.');
                    nuoveRighe.forEach(a => {
                        if (!a.collaudo) a.collaudo = { data: '', tecnico: '', esito: 'Da eseguire', noteVerifica: '', fileWord: '', foto: [] };
                        a.collaudo.foto = perAlloggio[String(a.civico) + '-' + String(a.interno)] || [];
                    });
                }
                await FotoDB.sostituisci(records);
                this.alloggi = nuoveRighe;
                this.salvaDati();
                if (typeof this.sincronizzaFoto === 'function') await this.sincronizzaFoto();
                this.zipMsg = `✓ Ripristino completato: ${this.alloggi.length} righe e ${records.length} fotografie.`;
                alert(this.zipMsg);
            } catch (e) {
                this.zipMsg = 'Errore nel ripristino: ' + (e && e.message ? e.message : e);
                alert(this.zipMsg);
            } finally { this.zipInCorso = false; }
        }
    };
    const originale = window.valmauraApp;
    window.valmauraApp = function () { return Object.assign(originale(), extra); };
    const btnJson = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Esporta Backup JSON'));
    if (btnJson) {
        const stile = 'px-4 py-2.5 text-white text-xs font-bold rounded-xl shadow-sm transition-all disabled:opacity-50';
        btnJson.insertAdjacentHTML('beforebegin', `<button @click="esportaZip()" :disabled="zipInCorso" class="${stile} bg-slate-700 hover:bg-slate-600">📦 ZIP completo (dati + foto)</button>
            <label class="${stile} bg-indigo-600 hover:bg-indigo-500 cursor-pointer">↩ Ripristina ZIP
                <input type="file" accept=".zip,application/zip" class="hidden" @change="importaZip($event)" :disabled="zipInCorso">
            </label>`);
        btnJson.parentElement.insertAdjacentHTML('afterend', `<div x-show="zipMsg" class="w-full text-xs font-semibold text-slate-600"><span x-text="zipMsg"></span></div>`);
    }
})();

/**
 * Validacion externa: imprime nuestros indicadores sobre datos reales para
 * que los compares a mano contra TradingView (BINANCE:BTCUSDT).
 *
 * Los tests de propiedades demuestran que las formulas son coherentes.
 * Esto demuestra que ademas coinciden con la referencia que usa todo el
 * mundo. Son dos cosas distintas y hacen falta las dos.
 */
import { readFileSync } from 'node:fs';
import { ema, rsi, macd, atr, volumenRelativo, ultimo } from '../lib/indicadores.mjs';

const datos = JSON.parse(readFileSync('data/ohlcv.json', 'utf8'));

for (const tf of ['1d', '4h', '1h']) {
  const serie = datos.series[tf];
  const velas = serie.velas;

  // Separamos la vela en curso: sus indicadores cambian minuto a minuto.
  const enCurso = velas[velas.length - 1].enCurso;
  const cerradas = enCurso ? velas.slice(0, -1) : velas;

  const calcular = (v) => {
    const cierres = v.map((x) => x.c);
    const m = macd(cierres);
    return {
      cierre: cierres[cierres.length - 1],
      fecha: v[v.length - 1].fecha.slice(0, 16).replace('T', ' '),
      ema20: ultimo(ema(cierres, 20)),
      ema50: ultimo(ema(cierres, 50)),
      ema200: ultimo(ema(cierres, 200)),
      rsi14: ultimo(rsi(cierres, 14)),
      macd: ultimo(m.linea),
      senal: ultimo(m.senal),
      hist: ultimo(m.histograma),
      atr14: ultimo(atr(v, 14)),
      volRel: ultimo(volumenRelativo(v.map((x) => x.v), 20)),
    };
  };

  const c = calcular(cerradas);
  const viva = enCurso ? calcular(velas) : null;
  const f = (x, d = 2) => (x === null ? '   n/d' : x.toFixed(d));

  console.log('\n' + '='.repeat(60));
  console.log('BTCUSDT  ' + tf + '   ' + serie.cantidad + ' velas');
  console.log('='.repeat(60));
  console.log('                    ULTIMA CERRADA      VELA EN CURSO');
  console.log('  fecha (UTC)       ' + c.fecha.padEnd(19) + (viva ? viva.fecha : ''));
  console.log('  cierre            ' + f(c.cierre).padEnd(19) + (viva ? f(viva.cierre) : ''));
  console.log('  EMA 20            ' + f(c.ema20).padEnd(19) + (viva ? f(viva.ema20) : ''));
  console.log('  EMA 50            ' + f(c.ema50).padEnd(19) + (viva ? f(viva.ema50) : ''));
  console.log('  EMA 200           ' + f(c.ema200).padEnd(19) + (viva ? f(viva.ema200) : ''));
  console.log('  RSI 14            ' + f(c.rsi14).padEnd(19) + (viva ? f(viva.rsi14) : ''));
  console.log('  MACD linea        ' + f(c.macd).padEnd(19) + (viva ? f(viva.macd) : ''));
  console.log('  MACD senal        ' + f(c.senal).padEnd(19) + (viva ? f(viva.senal) : ''));
  console.log('  MACD histograma   ' + f(c.hist).padEnd(19) + (viva ? f(viva.hist) : ''));
  console.log('  ATR 14            ' + f(c.atr14).padEnd(19) + (viva ? f(viva.atr14) : ''));
  console.log('  Volumen relativo  ' + f(c.volRel, 2).padEnd(19) + (viva ? f(viva.volRel, 2) : ''));

  if (viva) {
    const deriva = Math.abs(viva.rsi14 - c.rsi14);
    console.log('\n  El RSI difiere en ' + deriva.toFixed(2) + ' puntos entre la vela cerrada');
    console.log('  y la viva. Esa diferencia es el repintado, y seguira cambiando.');
  }
}

console.log('\nPara validar: abre TradingView en BINANCE:BTCUSDT, pon el mismo');
console.log('timeframe y compara con la columna VELA EN CURSO (es lo que muestra).');
console.log('Ajusta el huso horario del grafico a UTC para que las velas cuadren.');

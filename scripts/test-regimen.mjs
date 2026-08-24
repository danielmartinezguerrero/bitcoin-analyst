/**
 * Verificacion de lib/regimen.mjs con series cuyo regimen conocemos porque
 * lo hemos construido nosotros.
 */
import { efficiencyRatio, percentil, clasificarRegimen, UMBRALES } from '../lib/regimen.mjs';

let pasados = 0, fallados = 0;
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { pasados++; console.log('  ok   ' + nombre); }
  else { fallados++; console.log('  FALLO ' + nombre + (detalle ? '  -> ' + detalle : '')); }
}
const cerca = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

console.log('\nEfficiency Ratio');
{
  // Subida perfectamente recta: todo el recorrido es avance -> ER = 1.
  const recta = Array.from({ length: 30 }, (_, i) => 100 + i);
  comprobar('subida en linea recta -> ER = 1',
    cerca(efficiencyRatio(recta, 20).valor, 1), String(efficiencyRatio(recta, 20).valor));
  comprobar('y la direccion es positiva', efficiencyRatio(recta, 20).direccion === 1);

  const bajada = Array.from({ length: 30 }, (_, i) => 130 - i);
  comprobar('bajada recta -> ER = 1 con direccion negativa',
    cerca(efficiencyRatio(bajada, 20).valor, 1) && efficiencyRatio(bajada, 20).direccion === -1);

  // Sube y baja alternando volviendo al inicio: avance neto cero -> ER = 0.
  const zigzag = [];
  for (let i = 0; i < 31; i++) zigzag.push(100 + (i % 2) * 5);
  comprobar('zigzag que vuelve al origen -> ER = 0',
    cerca(efficiencyRatio(zigzag, 20).valor, 0), String(efficiencyRatio(zigzag, 20).valor));

  // Caso del comentario: +100, -100, +100 -> neto 100, recorrido 300.
  const idaYVuelta = [0, 100, 0, 100];
  comprobar('sube 100, baja 100, sube 100 -> ER = 1/3',
    cerca(efficiencyRatio(idaYVuelta, 3).valor, 1 / 3),
    String(efficiencyRatio(idaYVuelta, 3).valor));

  comprobar('siempre queda entre 0 y 1', (() => {
    const ruido = Array.from({ length: 200 }, () => 70000 + Math.random() * 5000);
    for (let n = 5; n <= 50; n += 5) {
      const v = efficiencyRatio(ruido, n).valor;
      if (v < 0 || v > 1) return false;
    }
    return true;
  })());

  comprobar('serie plana -> ER = 0 sin dividir por cero',
    efficiencyRatio(new Array(30).fill(100), 20).valor === 0);
  comprobar('datos insuficientes -> null', efficiencyRatio([1, 2, 3], 20).valor === null);

  // Una tendencia con ruido debe puntuar por debajo de la recta pura.
  const conRuido = Array.from({ length: 30 }, (_, i) => 100 + i + (i % 3) * 4);
  comprobar('la misma tendencia con ruido baja el ER',
    efficiencyRatio(conRuido, 20).valor < efficiencyRatio(recta, 20).valor,
    efficiencyRatio(conRuido, 20).valor.toFixed(3));
}

console.log('\nPercentil');
{
  const creciente = Array.from({ length: 100 }, (_, i) => i);
  comprobar('el valor mas alto de la serie -> percentil cercano a 1',
    percentil(creciente, 100) > 0.99, String(percentil(creciente, 100)));

  const decreciente = Array.from({ length: 100 }, (_, i) => 100 - i);
  comprobar('el valor mas bajo -> percentil cercano a 0',
    percentil(decreciente, 100) < 0.01, String(percentil(decreciente, 100)));

  const mitad = [...Array.from({ length: 50 }, () => 1), ...Array.from({ length: 49 }, () => 3), 2];
  const p = percentil(mitad, 100);
  comprobar('un valor intermedio cae en torno a la mitad', p > 0.4 && p < 0.6, String(p));
  comprobar('con menos de 20 datos devuelve null', percentil([1, 2, 3], 100) === null);
  // REGRESION: una serie constante daba percentil 0 ("minimo historico").
  comprobar('serie constante -> percentil 0,5, no 0',
    cerca(percentil(new Array(50).fill(7), 100), 0.5), String(percentil(new Array(50).fill(7), 100)));
  comprobar('ignora los nulls de la serie',
    percentil([null, null, 1, 2, 3, ...Array.from({ length: 20 }, (_, i) => i)], 100) !== null);
}

console.log('\nClasificacion de regimen');
{
  const velasDe = (cierres) => cierres.map((c) => ({ o: c, h: c * 1.01, l: c * 0.99, c, v: 1000 }));
  const atrPlano = new Array(300).fill(500);

  const tendencia = velasDe(Array.from({ length: 300 }, (_, i) => 60000 + i * 60));
  const rt = clasificarRegimen(tendencia, atrPlano);
  comprobar('escalera ascendente -> tendencia alcista',
    rt.tipo === 'tendencia alcista', rt.tipo + ' (ER ' + rt.er + ')');
  comprobar('y se marca como favorable para operativa direccional',
    rt.favorableParaTendencia === true);

  const bajista = velasDe(Array.from({ length: 300 }, (_, i) => 90000 - i * 60));
  comprobar('escalera descendente -> tendencia bajista',
    clasificarRegimen(bajista, atrPlano).tipo === 'tendencia bajista');

  // Oscilacion amplia sin avance neto.
  // Zigzag de periodo 4: en una ventana de 20 caben 5 ciclos completos, asi
  // que el avance neto es nulo por construccion. Un seno de periodo 12,6 no
  // lo garantiza y el test medía la fase, no el regimen.
  const patron = [0, 3000, 0, -3000];
  const lateral = velasDe(Array.from({ length: 300 }, (_, i) => 70000 + patron[i % 4]));
  const rl = clasificarRegimen(lateral, atrPlano);
  comprobar('oscilacion sin avance -> rango', rl.tipo === 'rango', rl.tipo + ' (ER ' + rl.er + ')');
  comprobar('y NO se marca como favorable', rl.favorableParaTendencia === false);

  comprobar('el ER declarado coincide con el calculado aparte',
    cerca(rt.er, Number(efficiencyRatio(tendencia.map((v) => v.c), UMBRALES.periodoER).valor.toFixed(3)), 1e-9));
  comprobar('toda clasificacion trae su descripcion en texto',
    [rt, rl].every((x) => typeof x.descripcion === 'string' && x.descripcion.length > 20));
}

console.log('\nEstado de volatilidad');
{
  const velasDe = (cierres) => cierres.map((c) => ({ o: c, h: c, l: c, c, v: 1000 }));
  const serie = velasDe(Array.from({ length: 300 }, (_, i) => 70000 + i * 30));

  const atrSubiendo = Array.from({ length: 300 }, (_, i) => 100 + i * 5);
  comprobar('ATR en maximos de su historia -> volatilidad alta',
    clasificarRegimen(serie, atrSubiendo).volatilidadEstado === 'alta');

  const atrBajando = Array.from({ length: 300 }, (_, i) => 1600 - i * 5);
  comprobar('ATR en minimos -> volatilidad baja',
    clasificarRegimen(serie, atrBajando).volatilidadEstado === 'baja');

  comprobar('ATR plano -> volatilidad normal',
    clasificarRegimen(serie, new Array(300).fill(500)).volatilidadEstado === 'normal');
}

console.log('\n' + '-'.repeat(52));
console.log('Pasados: ' + pasados + '   Fallados: ' + fallados);
process.exit(fallados === 0 ? 0 : 1);

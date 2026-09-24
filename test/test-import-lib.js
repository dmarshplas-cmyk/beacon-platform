/** test-import-lib.js — CSV parsing, sniffing, mapping, assignment validation. */
const path = require("path");
const imp = require(path.join(__dirname, "..", "src", "import-lib.js"));

let pass = 0, fail = 0;
const check = (name, got, expect) => {
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n    got      ${JSON.stringify(got)}\n    expected ${JSON.stringify(expect)}`); }
};

console.log("── parseCsv ──");
check("basic", imp.parseCsv("a,b\n1,2"), [["a","b"],["1","2"]]);
check("quoted comma", imp.parseCsv('a,b\n"Flat 1, Bridge House",SY16'), [["a","b"],["Flat 1, Bridge House","SY16"]]);
check("escaped quote", imp.parseCsv('a\n"He said ""hi"""'), [["a"],['He said "hi"']]);
check("crlf + blank lines", imp.parseCsv("a,b\r\n1,2\r\n\r\n3,4\r\n"), [["a","b"],["1","2"],["3","4"]]);
check("empty", imp.parseCsv(""), []);

console.log("── mapStock ──");
const csv = [
  "UPRN,Address 1,Town,Postcode,Property,Floor_Area",
  '100012345,"1 Plas Llysyn",Carno,SY17 5LP,1 Plas Llysyn,',
  "100012346,2 Plas Llysyn,Carno,sy17 5lp,2 Plas Llysyn,95",
  "100012345,Dup Row,Carno,SY17 5LP,Dup,",
  ",,,BADPC,No Address Row,",
].join("\n");
const m = imp.mapStock(csv, { tenantId: "acme" });
check("mapping sniffed", m.mapping, { id: "UPRN", name: "Property", addr1: "Address 1", town: "Town", postcode: "Postcode", floor: "Floor_Area" });
check("three sites (dup dropped)", m.sites.length, 3);
check("site id slug", m.sites[0].site_id, "acme-100012345");
check("postcode uppercased", m.sites[1].postcode, "SY17 5LP");
check("floor parsed", m.sites[1].floor, 95);
check("dup warning present", m.warnings.some((w) => w.includes("duplicate")), true);
check("bad postcode warned", m.warnings.some((w) => w.includes("BADPC")), true);

const noHdr = imp.mapStock("just,numbers\n1,2", { tenantId: "t" });
check("no usable columns → warning", noHdr.warnings[0], "Need at least an address or name column");

const withGps = imp.mapStock("ref,address,lat,lng\nA1,Somewhere,52.5,-3.5", { tenantId: "t" });
check("explicit lat/lng honoured", [withGps.sites[0].lat, withGps.sites[0].lng], [52.5, -3.5]);

console.log("── worksheetRows ──");
const ws = imp.worksheetRows([{ site_id: "acme-1", name: "One" }]);
check("worksheet row shape", ws[0], {
  site_id: "acme-1", site_name: "One", circuit_id: "acme-1-main",
  circuit_name: "Main incomer", role: "main", dev_eui: "", channel: 1,
});

console.log("── mapAssignments ──");
const aw = [
  "site_id,site_name,circuit_id,circuit_name,role,dev_eui,channel",
  "acme-1,One,acme-1-main,Main incomer,main,24E124746D481916,1",
  "acme-2,Two,acme-2-main,Main incomer,main,,1",
  "acme-3,Three,acme-3-x,Bad,sub,NOTANEUI,1",
  "acme-4,Four,acme-4-y,Bad role,king,24E124746D481917,1",
  ",,acme-5-z,No site,sub,24E124746D481918,1",
].join("\n");
const a = imp.mapAssignments(aw);
check("one valid row", a.rows.length, 1);
check("valid row shape", a.rows[0], {
  site_id: "acme-1", circuit_id: "acme-1-main", role: "main",
  dev_eui: "24E124746D481916", channel: 1, name: "Main incomer",
});
check("blank eui skipped not bad", a.skipped, 1);
check("three bad rows", a.bad.length, 3);
check("missing columns rejected", imp.mapAssignments("a,b\n1,2").bad[0].startsWith("Missing columns"), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

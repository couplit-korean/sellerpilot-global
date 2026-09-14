"""Compile reviewed July 2026 factual rates from the seven supplied XLSX files.

Read-only input extraction uses Python's standard library. No Google document is
modified and no spreadsheet formulas are executed. All retained cached numeric
rates are checked against their lossless piecewise-linear representation.
Usage: python3 scripts/import-shopee-price-tables.py /path/to/input-directory
Inputs: sellerpilot-sheet-1.xlsx ... sellerpilot-sheet-7.xlsx
"""
import hashlib, json, math, posixpath, sys, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

NS = {'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
CONFIG = [
 ('TW','대만','TWD','16HHhzRsxg3QiJTMJfPs46XoFR7Pvm7ai3IynwbNdUZo',1271427692,7,'IJKLMNO',6,20000,2,12.35,'TW Price Tool','J7:K7'),
 ('MX','멕시코','MXN','1G4dT9119UcZ7XPAQ9nDsvN13e2Mxx2219H7jFOQrZ4U',1389386158,11,'DE',6,15000,2,15.35,'MX Price Tool','J7:K7'),
 ('TH','태국','THB','1TJSmtFB60wmE9Q1Lin1WUhN2eq3byZDpxHBoEDeyASM',1577697739,8,'FGHI',6,30000,3.21,21.77,'TH Price Tool','J6:K6'),
 ('BR','브라질','BRL','1M624_9zJ4gNa8tXWJ3jmBMWBDjOrp89NbKvies_I1Xg',1783584448,4,'FGHI',6,30000,2,13.35,'BR Price Tool','J7:K7'),
 ('VN','베트남','VND','1QgCC0WNYfeeNa035muo5XSMECA8QND-cTEagaCifSfg',1715668820,11,'GHIJK',6,30000,4.91,17,'VN Price Tool','J8:K8'),
 ('MY','말레이시아','MYR','1jcNwhlxzkMH3sxFePYp8jDS704bV3xikVXYoLqQCA9w',845710254,11,'GHIJKLOPQ',7,30000,3.78,16.58,'New MY Price Tool','K12:L12'),
 ('PH','필리핀','PHP','1AK_XgHA_0CC7ggGjfPjgAc-h5fosfcda2UOPmokvNJE',1416708703,7,'FGHI',6,30000,2.4,10.01,'PH Price Tool','J8:K8'),
]
def rounded(x): return round(x,6)
def rows_from(path, sheet_number, columns, first, maximum):
 z=zipfile.ZipFile(path)
 rels={e.attrib['Id']:e.attrib['Target'] for e in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
 sheets=list(ET.fromstring(z.read('xl/workbook.xml')).find('s:sheets',NS));sheet=sheets[sheet_number-1]
 assert sheet.attrib['state']=='visible' and '2026.07.01' in sheet.attrib['name']
 target=rels[sheet.attrib[RID]];target=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)
 cells={c.attrib['r']:c for c in ET.fromstring(z.read(target)).findall('.//s:sheetData/s:row/s:c',NS)}
 values=[]
 for g in range(10,maximum+1,10):
  row=first+g//10-1
  def number(col):
   cell=cells.get(f'{col}{row}');v=cell.find('s:v',NS) if cell is not None else None
   if v is None or v.text is None or cell.attrib.get('t') in ('s','e','str'): return None
   n=float(v.text);assert math.isfinite(n) and n>=0;return rounded(n)
  assert number('A')==g
  vector=[number(c) for c in columns]
  # MY BSC net column is only populated through 10kg. Preserve unavailable
  # cells; never fill them with zero or extrapolate a service limit.
  assert all(v is not None or (columns[c] in 'JKL' and g>10000 and path.name=='sellerpilot-sheet-6.xlsx') for c,v in enumerate(vector)),(path,row,vector)
  values.append([g,vector])
 segments=[];i=0
 while i<len(values):
  start=i;delta=[0 if v is not None else None for v in values[i][1]];end=i
  if i+1<len(values) and all((a is None)==(b is None) for a,b in zip(values[i][1],values[i+1][1])):
   delta=[rounded(b-a) if a is not None else None for a,b in zip(values[i][1],values[i+1][1])];end=i+1
   while end+1<len(values):
    candidate=[rounded(a+d*(end+1-start)) if a is not None else None for a,d in zip(values[start][1],delta)]
    if candidate!=values[end+1][1]:break
    end+=1
  segments.append([values[start][0],values[end][0],values[start][1],delta])
  for k in range(start,end+1):
   assert [rounded(a+d*(k-start)) if a is not None else None for a,d in zip(values[start][1],delta)]==values[k][1]
  i=end+1
 return sheet.attrib['name'],segments,len(sheets),len(values)

if __name__=='__main__':
 input_dir=Path(sys.argv[1]);markets=[];coverage=[]
 for index,cfg in enumerate(CONFIG,1):
  code,name,currency,doc,gid,sheet,cols,first,maximum,transaction,commission,tool,fee_range=cfg
  path=input_dir/f'sellerpilot-sheet-{index}.xlsx'
  title,segments,tabs,rows=rows_from(path,sheet,cols,first,maximum)
  markets.append(dict(market=code,name=name,currency=currency,sourceUrl=f'https://docs.google.com/spreadsheets/d/{doc}/edit#gid={gid}',sourceSheet=title,sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest(),firstRow=first,columns=list(cols),maximumGrams=maximum,transactionPercent=transaction,commissionPercent=commission,feeSourceSheet=tool,feeSourceRange=fee_range,segments=segments))
  coverage.append(dict(market=code,tabs=tabs,rateRows=rows,segments=len(segments)))
 output=Path(__file__).resolve().parent.parent/'lib/pricing/shopee-rate-tables-20260701.json'
 output.write_text(json.dumps(dict(effectiveFrom='2026-07-01',retrievedOn='2026-09-14',markets=markets),ensure_ascii=False,separators=(',',':'))+'\n')
 print(json.dumps(dict(output=str(output),bytes=output.stat().st_size,coverage=coverage),ensure_ascii=False))

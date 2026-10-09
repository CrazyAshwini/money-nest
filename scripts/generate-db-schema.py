"""Regenerate Drizzle column metadata from the canonical reviewed SQL migration.

Supabase SQL migrations own constraints, policies, functions, views, and grants.
This script does not apply migrations or access credentials.
"""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
source = next((root / 'supabase/migrations').glob('*_finance_core.sql')).read_text(encoding='utf-8')

def camel(value):
    return re.sub(r'_([a-z])', lambda m: m[1].upper(), value)

def split_columns(body):
    result, depth, start = [], 0, 0
    for index, char in enumerate(body):
        if char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
        elif char == ',' and depth == 0:
            result.append(body[start:index].strip())
            start = index + 1
    result.append(body[start:].strip())
    return result

lines = ['// Generated with scripts/generate-db-schema.py. Canonical DDL/security: supabase/migrations.',
         'import { pgTable, uuid, text, numeric, boolean, integer, date, timestamp, jsonb, unique, foreignKey } from "drizzle-orm/pg-core";', '']
for match in re.finditer(r'create table public\.(\w+) \((.*?)\n\);', source, re.S):
    name, body = match.groups()
    columns, constraints = [], []
    for part in split_columns(body):
        column = re.match(r'(\w+) (uuid|text|numeric\((\d+),(\d+)\)|boolean|integer|date|timestamptz|jsonb)(.*)', part, re.S)
        if not column:
            constraints.append(part)
            continue
        field, kind, precision, scale, rest = column.groups()
        if kind.startswith('numeric'):
            expression = f'numeric("{field}", {{ precision: {precision}, scale: {scale} }})'
        elif kind == 'timestamptz':
            expression = f'timestamp("{field}", {{ withTimezone: true, mode: "string" }})'
        elif kind == 'date':
            expression = f'date("{field}", {{ mode: "string" }})'
        else:
            expression = f'{kind}("{field}")'
        if 'primary key' in rest:
            expression += '.primaryKey()'
        if 'not null' in rest:
            expression += '.notNull()'
        if 'default gen_random_uuid()' in rest:
            expression += '.defaultRandom()'
        elif 'default now()' in rest:
            expression += '.defaultNow()'
        elif 'default true' in rest:
            expression += '.default(true)'
        elif 'default false' in rest:
            expression += '.default(false)'
        elif "default '{}'" in rest:
            expression += '.default({})'
        elif (default := re.search(r"default '([^']*)'", rest)):
            expression += f'.default("{default[1]}")'
        elif 'default 0' in rest:
            expression += '.default("0")'
        columns.append(f'  {camel(field)}: {expression},')
    has_metadata = any(re.match(r'(foreign key|unique)\(',part) for part in constraints)
    lines.extend([f'export const {camel(name)} = pgTable("{name}", {{', *columns])
    if not has_metadata:
        lines.extend(['});', ''])
        continue
    lines.append('}, table => [')
    for part in constraints:
        if foreign := re.match(r'foreign key\(([^)]+)\) references public\.(\w+)\(([^)]+)\)', part):
            local, target, remote = foreign.groups()
            target_name = 'table' if target == name else camel(target)
            local_fields = ', '.join(f'table.{camel(v.strip())}' for v in local.split(','))
            remote_fields = ', '.join(f'{target_name}.{camel(v.strip())}' for v in remote.split(','))
            lines.append(f'  foreignKey({{ columns: [{local_fields}], foreignColumns: [{remote_fields}] }}),')
        elif unique := re.match(r'unique\(([^)]+)\)', part):
            fields = ', '.join(f'table.{camel(v.strip())}' for v in unique[1].split(','))
            lines.append(f'  unique().on({fields}),')
    lines.extend([']);', ''])
target = root / 'src/db/schema.ts'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text('\n'.join(lines), encoding='utf-8')
print(f'Generated Drizzle metadata for {len(list(re.finditer("export const", target.read_text())))} tables.')

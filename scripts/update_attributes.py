import re

# 1. Backend schema
with open('backend/schemas/__init__.py', 'r', encoding='utf-8') as f:
    c = f.read()
c = c.replace(
    '    display_name: str = Field("", description="展示名称")',
    '    display_name: str = Field("", description="展示名称")\n    example: str = Field("", description="示例")'
)
with open('backend/schemas/__init__.py', 'w', encoding='utf-8') as f:
    f.write(c)
print('Schema done')

# 2. Frontend Attribute interface
with open('frontend/src/api/client.ts', 'r', encoding='utf-8') as f:
    c = f.read()
c = c.replace('  display_name?: string;\n}', '  display_name?: string;\n  example?: string;\n}')
with open('frontend/src/api/client.ts', 'w', encoding='utf-8') as f:
    f.write(c)
print('Client interface done')

# 3. BehaviorTable - rename
with open('frontend/src/components/Design/BehaviorTable.tsx', 'r', encoding='utf-8') as f:
    c = f.read()
c = c.replace("'参数', key: 'params'", "'输入参数', key: 'params'")
with open('frontend/src/components/Design/BehaviorTable.tsx', 'w', encoding='utf-8') as f:
    f.write(c)
print('BehaviorTable done')

# 4. ConceptTable - type options and example field
with open('frontend/src/components/Design/ConceptTable.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

# Change type dropdown options
c = c.replace("['string', 'number', 'boolean', 'date', 'text', 'enum']", "['date', 'text', 'int', 'float', 'boolean']")

# Add example Input in attribute edit rows (after display_name Input)
old = '<Input value={attr.display_name || \'\'} onChange={e => { const n = [...attributes]; n[idx] = { ...n[idx], display_name: e.target.value }; setAttributes(n); }} className="w-28 bg-dark-bg border-dark-border text-text-primary" placeholder="展示名" />\n              <select'
new = '<Input value={attr.display_name || \'\'} onChange={e => { const n = [...attributes]; n[idx] = { ...n[idx], display_name: e.target.value }; setAttributes(n); }} className="w-28 bg-dark-bg border-dark-border text-text-primary" placeholder="展示名" />\n              <Input value={attr.example || \'\'} onChange={e => { const n = [...attributes]; n[idx] = { ...n[idx], example: e.target.value }; setAttributes(n); }} className="w-28 bg-dark-bg border-dark-border text-text-primary" placeholder="示例" />\n              <select'
c = c.replace(old, new)

# Add example Input in add-new section
old2 = '<Input placeholder="展示名" value={newAttrDisplayName} onChange={e => setNewAttrDisplayName(e.target.value)} className="w-28 bg-dark-bg border-dark-border text-text-primary" />\n            <select'
new2 = '<Input placeholder="展示名" value={newAttrDisplayName} onChange={e => setNewAttrDisplayName(e.target.value)} className="w-28 bg-dark-bg border-dark-border text-text-primary" />\n            <Input placeholder="示例" value={newAttrExample} onChange={e => setNewAttrExample(e.target.value)} className="w-28 bg-dark-bg border-dark-border text-text-primary" />\n            <select'
c = c.replace(old2, new2)

# Add newAttrExample state
c = c.replace(
    'const [newAttrDisplayName, setNewAttrDisplayName] = useState(\'\');',
    'const [newAttrDisplayName, setNewAttrDisplayName] = useState(\'\');\n  const [newAttrExample, setNewAttrExample] = useState(\'\');'
)

# Update handleAddAttribute
c = c.replace(
    'display_name: newAttrDisplayName.trim() })',
    'display_name: newAttrDisplayName.trim(), example: newAttrExample.trim() })'
)

# Reset newAttrExample
c = c.replace(
    'setNewAttrDisplayName(\'\');',
    'setNewAttrDisplayName(\'\'); setNewAttrExample(\'\');'
)

with open('frontend/src/components/Design/ConceptTable.tsx', 'w', encoding='utf-8') as f:
    f.write(c)
print('ConceptTable done')

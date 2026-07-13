import re

# ConceptTable
with open('frontend/src/components/Design/ConceptTable.tsx', 'r', encoding='utf-8') as f:
    c = f.read()
c = c.replace("'概念名称', dataIndex: 'name'", "'名称', dataIndex: 'name'")
c = c.replace("'概念描述', dataIndex: 'description'", "'描述', dataIndex: 'description'")
with open('frontend/src/components/Design/ConceptTable.tsx', 'w', encoding='utf-8') as f:
    f.write(c)
print('ConceptTable done')

# RelationTable
with open('frontend/src/components/Design/RelationTable.tsx', 'r', encoding='utf-8') as f:
    c = f.read()
c = c.replace("'说明', dataIndex: 'description'", "'描述', dataIndex: 'description'")
with open('frontend/src/components/Design/RelationTable.tsx', 'w', encoding='utf-8') as f:
    f.write(c)
print('RelationTable done')

# RuleTable
with open('frontend/src/components/Design/RuleTable.tsx', 'r', encoding='utf-8') as f:
    c = f.read()
c = re.sub(r"\s*\{ title: '编号', dataIndex: 'id', key: 'id', width: 50 \},", '', c)
c = c.replace("'规则名称', dataIndex: 'name'", "'名称', dataIndex: 'name'")
with open('frontend/src/components/Design/RuleTable.tsx', 'w', encoding='utf-8') as f:
    f.write(c)
print('RuleTable done')

# EventTable
with open('frontend/src/components/Design/EventTable.tsx', 'r', encoding='utf-8') as f:
    c = f.read()
c = c.replace("'事件名称', dataIndex: 'name'", "'名称', dataIndex: 'name'")
with open('frontend/src/components/Design/EventTable.tsx', 'w', encoding='utf-8') as f:
    f.write(c)
print('EventTable done')

print('All done')

import sys
filepath = sys.argv[1]
content = open(filepath, 'r', encoding='utf-8').read()

# Check if the file has the full content
if len(content) < 500:
    print("File is truncated, need to restore")
    # File was truncated, need to write the full content
    full = open('d:/公司项目/智能体/optonto/frontend/src/components/Design/BehaviorTable_full.txt', 'r').read()
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(full)
    print("Restored full file")
else:
    print("File is OK, no changes needed")

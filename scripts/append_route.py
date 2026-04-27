with open('backend/routes/transcription.py.append.txt', 'r') as f:
    content = f.read()
with open('backend/routes/transcription.py', 'a') as g:
    g.write(content)
import os
os.remove('backend/routes/transcription.py.append.txt')

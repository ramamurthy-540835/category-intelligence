#!/bin/bash
echo "Starting Category Intelligence Agent..."

# Backend on 8001
cd backend
pip install -r requirements.txt -q
uvicorn main:app --host 0.0.0.0 --port 8001 --reload &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID on :8001"

# Wait for backend
sleep 4
curl -s http://localhost:8001/health && echo " Backend ready" || echo " Backend not ready"

# Frontend on 3001
cd ..
npm install -q
NEXT_PUBLIC_API_BASE_URL=http://localhost:8001 npm run dev -- --port 3001 &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID on :3001"

echo ""
echo "App    -> http://localhost:3001"
echo "API    -> http://localhost:8001"
echo "Docs   -> http://localhost:8001/docs"

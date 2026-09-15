import autocannon from 'autocannon';

async function runLoadTest() {
  console.log('🚀 Running Local API Load Test (50 connections, 10s duration)...');
  const result = await autocannon({
    url: process.env.TARGET_URL || 'http://localhost:3000/health',
    connections: 50,
    duration: 10,
    pipelining: 1,
  });

  console.log('📊 Load Test Results:');
  console.log(`   - 2xx Responses: ${result['2xx']}`);
  console.log(`   - Non-2xx Responses: ${result.non2xx}`);
  console.log(`   - Avg Latency: ${result.latency.average} ms`);
  console.log(`   - p99 Latency: ${result.latency.p99} ms`);
  console.log(`   - Throughput: ${result.requests.average} req/sec`);
}

runLoadTest().catch(console.error);

require('dotenv').config({ path: '.env.local' });

async function testResponsesAPI() {
  // Dynamic import for node-fetch
  const { default: fetch } = await import('node-fetch');
  
  const openaiApiKey = process.env.OPENAI_API_KEY;
  
  if (!openaiApiKey) {
    console.log('❌ OPENAI_API_KEY not found in environment');
    return;
  }
  
  console.log('✅ OPENAI_API_KEY found');
  console.log('🔑 Key prefix:', openaiApiKey.substring(0, 20) + '...');
  
  try {
    // Test 1: Standard OpenAI API access (models endpoint)
    console.log('\n🧪 Testing OpenAI API access...');
    const modelsResponse = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
      },
    });
    
    if (modelsResponse.ok) {
      console.log('✅ OpenAI API accessible');
    } else {
      console.log('❌ OpenAI API not accessible:', modelsResponse.status, modelsResponse.statusText);
      return;
    }
    
    // Test 2: Responses API endpoint test
    console.log('\n🧪 Testing Responses API...');
    const responsesApiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        input: 'Hello, this is a test of the Responses API',
      }),
    });
    
    const responseData = await responsesApiResponse.text();
    
    if (responsesApiResponse.ok) {
      console.log('✅ Responses API accessible and working');
      console.log('📝 Response preview:', responseData.substring(0, 200) + '...');
    } else {
      console.log('❌ Responses API error:', responsesApiResponse.status, responsesApiResponse.statusText);
      console.log('📝 Error details:', responseData);
    }
    
    // Test 3: Whisper API (used by transcription)
    console.log('\n🧪 Testing Whisper API availability...');
    // We won't send actual audio, just check if the endpoint is accessible
    const { FormData } = await import('node-fetch');
    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
      },
      // Empty form data will trigger a validation error, but confirms endpoint accessibility
      body: new FormData(),
    });
    
    if (whisperResponse.status === 400) {
      console.log('✅ Whisper API accessible (400 expected for empty request)');
    } else {
      console.log('⚠️ Whisper API unexpected response:', whisperResponse.status);
    }
    
  } catch (error) {
    console.error('❌ Error testing APIs:', error.message);
  }
}

testResponsesAPI(); 
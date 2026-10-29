Pod::Spec.new do |s|
  s.name           = 'LabelText'
  s.version        = '1.0.0'
  s.summary        = 'On-device wine label OCR with Apple Vision'
  s.description    = 'Reads label text with VNRecognizeTextRequest for the WineTracker app'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision', 'PDFKit'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
